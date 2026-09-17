import type { Editor } from '@tiptap/react'

/**
 * What a Docs command acts on.
 *
 * The registry keeps the context deliberately unnamed so that each app can say
 * what its own commands touch; here it is the editor, because every command in
 * this app is an edit to the document or a view of it.
 *
 * Declared once, in its own module, so that importing anything from the
 * registry brings the augmentation with it — a file that saw the bare
 * interface would think `ctx.editor` does not exist.
 */
declare module '@orangery/ui-kit' {
  interface CommandContext {
    editor: Editor
  }
}

export {}
