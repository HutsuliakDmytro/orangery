import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

/**
 * `Mod+Shift+V` — paste without formatting.
 *
 * A flag rather than a separate paste path: the keymap arms it, the next paste
 * consumes it. ProseMirror gives no way to tell the two shortcuts apart inside
 * `handlePaste`, because the paste event carries no modifier state.
 */

export const pastePlainTextKey = new PluginKey<boolean>('pastePlainText')

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pastePlainText: {
      armPlainTextPaste: () => ReturnType
    }
  }
}

export const PastePlainText = Extension.create({
  name: 'pastePlainText',

  addProseMirrorPlugins() {
    return [
      new Plugin<boolean>({
        key: pastePlainTextKey,

        state: {
          init: () => false,
          apply(tr, value) {
            const meta = tr.getMeta(pastePlainTextKey) as boolean | undefined
            return meta ?? value
          },
        },

        props: {
          handlePaste(view, event) {
            if (!pastePlainTextKey.getState(view.state)) return false

            const text = event.clipboardData?.getData('text/plain') ?? ''
            view.dispatch(view.state.tr.setMeta(pastePlainTextKey, false))
            if (text === '') return true

            // insertText keeps the surrounding marks off, which is the point.
            view.dispatch(view.state.tr.insertText(text))
            return true
          },
        },
      }),
    ]
  },

  addCommands() {
    return {
      armPlainTextPaste:
        () =>
        ({ tr, dispatch }) => {
          dispatch?.(tr.setMeta(pastePlainTextKey, true))
          return true
        },
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-v': () => {
        this.editor.commands.armPlainTextPaste()
        // Let the browser deliver the paste; handlePaste consumes the flag.
        return false
      },
    }
  },
})
