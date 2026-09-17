import type { Editor } from '@tiptap/core'
import { AllSelection, TextSelection } from '@tiptap/pm/state'

/**
 * Replaces an `AllSelection` with an equivalent `TextSelection`.
 *
 * `Mod+A` produces an `AllSelection`, which ProseMirror's list commands reject:
 * `liftListItem` needs `$from.blockRange($to)`, and an `AllSelection` starts at
 * the document node rather than inside a textblock. The visible symptom is that
 * select-all then toggling a list off does nothing, where Docs and Word remove
 * the list. Converting to the equivalent text range keeps the same content
 * selected and lets the block commands work.
 *
 * Returns true when a conversion happened, so callers can tell it apart from a
 * selection that was already usable.
 */
export function selectWholeDocument(editor: Editor): void {
  const { state, view } = editor
  const { doc } = state
  const selection = TextSelection.between(doc.resolve(0), doc.resolve(doc.content.size))
  view.dispatch(state.tr.setSelection(selection))
  editor.commands.focus()
}

export function normalizeBlockSelection(editor: Editor): boolean {
  const { state } = editor
  if (!(state.selection instanceof AllSelection)) return false

  const { doc } = state
  const selection = TextSelection.between(doc.resolve(0), doc.resolve(doc.content.size))
  editor.view.dispatch(state.tr.setSelection(selection))
  return true
}
