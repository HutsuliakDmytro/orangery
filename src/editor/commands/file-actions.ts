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
import { readSectionHeaders, writeSectionHeaders } from '../../document/section-headers'
import { useHeaderFooterStore } from '../../store/header-footer-store'
import { useCommentsStore } from '../../store/comments-store'
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
  const section = useViewStore.getState().section

  // Only the section the values belong to is touched. They are shown for the
  // section the cursor is in, and writing them anywhere else would move a
  // header into a section nobody was editing.
  if (headerFooter.sectionKey !== null) return

  useViewStore.getState().setSection(writeSectionHeaders(pkg, section, headerFooter))
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
        useViewStore.getState().setHeadingNumbering(docx.headingNumbering)
        useStylesStore.getState().setCatalogue(docx.styles)
        useCommentsStore.getState().reset()
        useViewStore.getState().setTrackChanges(false)
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
          useViewStore.getState().setHeadingNumbering(opened.session.docx.headingNumbering)
          useStylesStore.getState().setCatalogue(opened.session.docx.styles)
          useCommentsStore.getState().load(opened.session.docx.comments)
          useViewStore.getState().setTrackChanges(opened.session.docx.trackChanges)

          const { pkg, section } = opened.session.docx
          useHeaderFooterStore.getState().load(readSectionHeaders(pkg, section), null)
        } else {
          // A converted format has no style catalogue of its own, and nothing
          // that says its headings are numbered.
          useStylesStore.getState().setCatalogue(null)
          useCommentsStore.getState().reset()
          useViewStore.getState().setHeadingNumbering(null)
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
        const result = await saveDocumentTo(session, docJson(editor), path, {
          section: useViewStore.getState().section,
          headingNumbering: useViewStore.getState().headingNumbering,
          comments: useCommentsStore.getState().comments,
          trackChanges: useViewStore.getState().trackChanges,
        })
        useDocumentStore.getState().markSaved(result.path, format)
        // A conversion may have left something behind; the banner says what.
        if (result.warnings) useDocumentStore.getState().addWarnings(result.warnings)
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
        const result = await saveDocumentTo(session, docJson(editor), target, {
          section: useViewStore.getState().section,
          headingNumbering: useViewStore.getState().headingNumbering,
          comments: useCommentsStore.getState().comments,
          trackChanges: useViewStore.getState().trackChanges,
        })
        useDocumentStore.getState().markSaved(result.path, targetFormat)
        if (result.warnings) useDocumentStore.getState().addWarnings(result.warnings)
        await rememberRecent(result.path)
      } catch (error) {
        reportFailure('Saving', error)
      }
    })
  },
}
