import type { Editor } from '@tiptap/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readDocumentFile } from '../../document/file-operations'
import type { OpenSession } from '../../document/file-operations'
import { dataUrlFrom, extensionFor } from '../../document/data-url'
import {
  addImage,
  naturalSize,
  UnsupportedImageError,
  unsupportedImageMessage,
} from '../../document/media'
import { addPicture } from '../../document/odt-file'
import { getSession } from '../../document/session'
import { fitWithin } from '@orangery/ooxml-drawingml'
import { isTauri } from '@orangery/platform'
import { contentWidth } from '../../ooxml/section'
import { useDocumentStore } from '../../store/document-store'
import { useViewStore } from '../../store/view-store'

/**
 * Inserting an image.
 *
 * The bytes go into the package before the node is inserted: a node pointing at
 * a relationship that does not exist would produce a file Word offers to repair.
 *
 * A document converted from a flat format has no package to put them in. There
 * the picture travels in the document as a data URL and is written into a
 * package when the file is saved, which is what `embedImages` does.
 */

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp']

/**
 * Stores the bytes where the open document keeps its pictures, and returns what
 * the node needs to find them again.
 */
function storeInSession(
  session: OpenSession,
  fileName: string,
  bytes: Uint8Array,
): Record<string, unknown> {
  switch (session.kind) {
    case 'docx':
      return { relationshipId: addImage(session.docx.pkg, fileName, bytes).relationshipId }
    case 'odt': {
      const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
      return { href: addPicture(session.odt.pkg, extensionFor(extension), bytes) }
    }
    case 'flat':
      // Nothing to store: there is no package until the document is saved.
      return {}
  }
}

/** Shared tail of every insert path: package first, then the node. */
async function embed(editor: Editor, fileName: string, bytes: Uint8Array): Promise<void> {
  const session = getSession()
  if (!session) return

  try {
    const src = dataUrlFrom(bytes, fileName)
    if (src === null) throw new UnsupportedImageError(unsupportedImageMessage(fileName))

    const stored = storeInSession(session, fileName, bytes)

    const natural = await naturalSize(src)
    const size = fitWithin(natural, contentWidth(useViewStore.getState().section))

    editor
      .chain()
      .focus()
      .insertContent({
        type: 'image',
        attrs: {
          src,
          alt: '',
          width: size.width,
          height: size.height,
          wrap: 'inline',
          ...stored,
          imageId: Date.now() % 100000,
        },
      })
      .run()
  } catch (error) {
    useDocumentStore.getState().addWarnings([
      {
        tag: 'image',
        message:
          error instanceof UnsupportedImageError
            ? error.message
            : `Could not insert the image: ${error instanceof Error ? error.message : String(error)}`,
      },
    ])
  }
}

/** A pasted screenshot has no name; Word names them by type. */
function nameFor(file: File): string {
  if (file.name !== '') return file.name
  const extension = file.type.split('/')[1] ?? 'png'
  return `pasted.${extension === 'jpeg' ? 'jpg' : extension}`
}

export const imageActions = {
  /** Clipboard and drag-and-drop, which both hand us `File` objects. */
  async insertFiles(editor: Editor, files: readonly File[]): Promise<void> {
    for (const file of files) {
      const bytes = new Uint8Array(await file.arrayBuffer())
      await embed(editor, nameFor(file), bytes)
    }
  },

  async insertFromFile(editor: Editor, path?: string): Promise<void> {
    let target = path
    if (target === undefined) {
      if (!isTauri()) return
      const selected = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: 'Images', extensions: IMAGE_EXTENSIONS }],
      })
      if (typeof selected !== 'string') return
      target = selected
    }

    const bytes = await readDocumentFile(target)
    await embed(editor, target.split(/[\\/]/u).pop() ?? 'image.png', bytes)
  },
}
