import type { Editor } from '@tiptap/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { readDocumentFile } from '../../document/file-operations'
import { addImage, UnsupportedImageError } from '../../document/media'
import { getSession } from '../../document/session'
import { fitWithin } from '../../ooxml/image'
import { isTauri } from '../../platform/os'
import { contentWidth } from '../../ooxml/section'
import { useDocumentStore } from '../../store/document-store'
import { useViewStore } from '../../store/view-store'

/**
 * Inserting an image.
 *
 * The bytes go into the package and a relationship is created before the node is
 * inserted: a node pointing at a relationship that does not exist would produce
 * a file Word offers to repair.
 */

const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'tif', 'tiff', 'webp']

/** Reads the natural size of an image, in points at 96dpi. */
async function naturalSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => {
      resolve({ width: image.naturalWidth * (72 / 96), height: image.naturalHeight * (72 / 96) })
    }
    // A picture we cannot measure still gets inserted, at the column width.
    image.onerror = () => {
      resolve({ width: 0, height: 0 })
    }
    image.src = dataUrl
  })
}

/** Shared tail of every insert path: package first, then the node. */
async function embed(editor: Editor, fileName: string, bytes: Uint8Array): Promise<void> {
  const session = getSession()
  if (session?.kind !== 'docx') {
    useDocumentStore
      .getState()
      .addWarnings([{ tag: 'image', message: 'Images can only be added to Word documents.' }])
    return
  }

  try {
    const added = addImage(session.docx.pkg, fileName, bytes)
    const { mediaDataUrl } = await import('../../document/media')
    const src = mediaDataUrl(session.docx.pkg, added.path) ?? ''

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
          relationshipId: added.relationshipId,
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
    const session = getSession()
    if (session?.kind !== 'docx') {
      useDocumentStore
        .getState()
        .addWarnings([{ tag: 'image', message: 'Images can only be added to Word documents.' }])
      return
    }

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
