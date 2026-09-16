import type { Editor } from '@tiptap/core'
import {
  createDocument,
  ensureExtension,
  openDocumentFrom,
  pickOpenPath,
  pickSavePath,
  saveDocumentTo,
  UnsupportedFormatError,
} from '../../document/file-operations'
import { fileNameOf, formatFromPath } from '../../document/formats'
import { rememberRecent } from '../../document/recent-files'
import { templateById } from '../../document/templates'
import type { TemplateId } from '../../document/templates'
import { getSession, setSession } from '../../document/session'
import { useDocumentStore } from '../../store/document-store'
import { readHeaderFooter, writeHeaderFooter } from '../../document/header-footer-session'
import { paragraphsFromText, textFromParagraphs } from '../../document/header-footer-text'
import { useHeaderFooterStore } from '../../store/header-footer-store'
import { useStylesStore } from '../../store/styles-store'
import { useViewStore } from '../../store/view-store'
import type { ProseMirrorNodeJson } from '../../ooxml/parse-document'

/**
 * The New / Open / Save / Save As workflow.
 *
 * Kept out of the command definitions so the registry stays declarative, and out
 * of React so the same code can be driven by the native menu, a shortcut or a
 * toolbar button without a component in the middle.
 */

function docJson(editor: Editor): ProseMirrorNodeJson {
  return editor.getJSON() as ProseMirrorNodeJson
}

/**
 * Writes the header and footer into the package and returns the section, which
 * gains a reference when a part had to be created. Done before the body, since
 * the body's `w:sectPr` has to carry that reference.
 */
function applyHeaderFooter(session: ReturnType<typeof getSession>): void {
  if (session?.kind !== 'docx') return

  const headerFooter = useHeaderFooterStore.getState()
  if (!headerFooter.dirty) return

  const { pkg } = session.docx
  let section = useViewStore.getState().section

  section = writeHeaderFooter(pkg, section, 'header', paragraphsFromText(headerFooter.header))
  section = writeHeaderFooter(pkg, section, 'footer', paragraphsFromText(headerFooter.footer))

  useViewStore.getState().setSection(section)
}

async function guardBusy<T>(work: () => Promise<T>): Promise<T | null> {
  const store = useDocumentStore.getState()
  if (store.busy) return null

  store.setBusy(true)
  try {
    return await work()
  } finally {
    useDocumentStore.getState().setBusy(false)
  }
}

function reportFailure(action: string, error: unknown): void {
  const message =
    error instanceof UnsupportedFormatError
      ? error.message
      : `${action} failed: ${error instanceof Error ? error.message : String(error)}`

  useDocumentStore.getState().addWarnings([{ tag: 'file', message }])
}

export const fileOperations = {
  async newDocument(editor: Editor, template: TemplateId = 'blank'): Promise<void> {
    await guardBusy(async () => {
      try {
        // Every template is the same DOCX package; only the content differs.
        const docx = await createDocument()
        setSession({ kind: 'docx', docx })
        useViewStore.getState().setSection(docx.section)
        useStylesStore.getState().setCatalogue(docx.styles)
        useHeaderFooterStore.getState().reset()
        editor.commands.setContent(templateById(template).build())
        useDocumentStore.getState().newDocument()
      } catch (error) {
        reportFailure('Creating a document', error)
      }
    })
  },

  async open(editor: Editor, path?: string): Promise<void> {
    const target = path ?? (await pickOpenPath())
    if (target === null) return

    await guardBusy(async () => {
      try {
        const opened = await openDocumentFrom(target)
        setSession(opened.session)
        if (opened.session.kind === 'docx') {
          useViewStore.getState().setSection(opened.session.docx.section)
          useStylesStore.getState().setCatalogue(opened.session.docx.styles)

          const { pkg, section } = opened.session.docx
          useHeaderFooterStore.getState().load({
            header: textFromParagraphs(readHeaderFooter(pkg, section, 'header').paragraphs),
            footer: textFromParagraphs(readHeaderFooter(pkg, section, 'footer').paragraphs),
          })
        } else {
          // A converted format has no style catalogue of its own.
          useStylesStore.getState().setCatalogue(null)
        }
        editor.commands.setContent(opened.doc)
        useDocumentStore.getState().openDocument({
          path: opened.path,
          format: opened.format,
          warnings: opened.warnings,
        })
        await rememberRecent(opened.path)
      } catch (error) {
        reportFailure(`Opening ${fileNameOf(target)}`, error)
      }
    })
  },

  async save(editor: Editor): Promise<void> {
    const { path, format } = useDocumentStore.getState()
    // A document that has never been saved has nowhere to go; Save becomes Save As.
    if (path === null) {
      await fileOperations.saveAs(editor)
      return
    }

    await guardBusy(async () => {
      const session = getSession()
      if (!session) return

      applyHeaderFooter(session)

      try {
        const result = await saveDocumentTo(
          session,
          docJson(editor),
          path,
          useViewStore.getState().section,
        )
        useDocumentStore.getState().markSaved(result.path, format)
      } catch (error) {
        reportFailure('Saving', error)
      }
    })
  },

  async saveAs(editor: Editor): Promise<void> {
    const { path, format } = useDocumentStore.getState()
    const suggested = path ?? `${fileNameOf(null)}.${format}`

    const chosen = await pickSavePath(suggested)
    if (chosen === null) return

    await guardBusy(async () => {
      const session = getSession()
      if (!session) return

      // Save As can change the format; the new path decides it.
      const target = ensureExtension(chosen, format)
      const targetFormat = formatFromPath(target) ?? format

      try {
        const result = await saveDocumentTo(
          session,
          docJson(editor),
          target,
          useViewStore.getState().section,
        )
        useDocumentStore.getState().markSaved(result.path, targetFormat)
        await rememberRecent(result.path)
      } catch (error) {
        reportFailure('Saving', error)
      }
    })
  },
}
