import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * Images pasted from the clipboard or dropped onto the page.
 *
 * Both arrive as `File` objects, and both have to go through the same path as
 * the Insert command: the bytes must land in `word/media/` with a relationship
 * before a node can reference them. Inserting the node first and wiring the
 * package afterwards would leave a window where a save produces a file Word
 * offers to repair.
 */

export const imageDropKey = new PluginKey('imageDrop')

export interface ImageDropOptions {
  /** Adds the file to the package and inserts the node. */
  onFiles: (files: File[]) => void
}

/** Files the OS hands us that we can actually embed. */
export function imageFilesFrom(list: FileList | null | undefined): File[] {
  if (!list) return []
  return [...list].filter((file) => file.type.startsWith('image/'))
}

export const ImageDrop = Extension.create<ImageDropOptions>({
  name: 'imageDrop',

  addOptions() {
    return { onFiles: () => undefined }
  },

  addProseMirrorPlugins() {
    const { onFiles } = this.options

    return [
      new Plugin({
        key: imageDropKey,

        props: {
          handlePaste(_view, event) {
            const files = imageFilesFrom(event.clipboardData?.files)
            if (files.length === 0) return false

            // Claimed here so the HTML branch does not also insert a copy: a
            // screenshot pasted from the clipboard carries both a file and an
            // `<img>` in text/html.
            event.preventDefault()
            onFiles(files)
            return true
          },

          handleDrop(_view, event) {
            const files = imageFilesFrom(event.dataTransfer?.files)
            if (files.length === 0) return false

            event.preventDefault()
            onFiles(files)
            return true
          },
        },
      }),
    ]
  },
})
