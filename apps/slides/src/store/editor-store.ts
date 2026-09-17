import { create } from 'zustand'
import type { Editor } from '@tiptap/core'

/**
 * The text editor that is open, if any.
 *
 * Commands reach the editor through here rather than through props: a menu item
 * and a keyboard shortcut both run through the registry, which knows nothing
 * about where on the slide the editor happens to be mounted.
 *
 * Holding an editor instance in a store is unusual and deliberate — it is one
 * live object, replaced when a different shape is entered and cleared when the
 * last one is left.
 */
interface EditorState {
  editor: Editor | null
  /** Bumped on every transaction, so a command's enabled state follows the cursor. */
  version: number
  set: (editor: Editor | null) => void
  touch: () => void
}

export const useEditorStore = create<EditorState>((set) => ({
  editor: null,
  version: 0,
  set: (editor) => {
    set({ editor, version: 0 })
  },
  touch: () => {
    set((state) => ({ version: state.version + 1 }))
  },
}))
