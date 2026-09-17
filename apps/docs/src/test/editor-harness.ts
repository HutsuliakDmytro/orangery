import { Editor } from '@tiptap/core'
import { registerBuiltinCommands } from '../editor/commands/definitions'
import { selectWholeDocument } from '../editor/commands/selection'
import { buildExtensions } from '../editor/extension-set'

/**
 * A headless editor with the production extension set, for command tests that
 * compare the document before and after a command runs.
 */
export function createTestEditor(content = '<p>hello world</p>'): Editor {
  registerBuiltinCommands()

  return new Editor({ extensions: buildExtensions(), content })
}

/**
 * Selects the whole document, the usual precondition for a formatting command.
 * Goes through the same path as `Mod+A` so tests see production behaviour.
 */
export function selectAll(editor: Editor): void {
  selectWholeDocument(editor)
}

/** Selects `text` inside the document; throws when it is not present. */
export function selectText(editor: Editor, text: string): void {
  const haystack = editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n')
  const index = haystack.indexOf(text)
  if (index === -1) throw new Error(`"${text}" not found in the document`)

  // textBetween strips node boundaries, so offset by one for the opening paragraph.
  const from = index + 1
  editor.commands.setTextSelection({ from, to: from + text.length })
}
