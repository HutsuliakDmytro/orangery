import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { Extensions } from '@tiptap/core'

/**
 * A headless editor carrying this package and nothing else.
 *
 * Deliberately not the app's extension set: a test that passes only because
 * something in Docs happens to be loaded would go on passing while the same
 * extension misbehaves in Slides.
 */
export function createTextEditor(extensions: Extensions, content = '<p></p>'): Editor {
  return new Editor({ extensions: [StarterKit, ...extensions], content })
}

/**
 * Types text one character at a time.
 *
 * Input rules fire on insertion, so pasting the whole string in would skip
 * every one of them — which is also why they must not fire on paste.
 */
export function type(editor: Editor, text: string): void {
  for (const character of text) {
    const { from, to } = editor.state.selection

    // The rule handler both applies the substitution and stands in for the
    // insertion, exactly as it does when a browser delivers the keystroke.
    const handled = editor.view.someProp(
      'handleTextInput',
      (handler) => handler(editor.view, from, to, character, () => editor.state.tr) === true,
    )
    if (handled !== true) editor.commands.insertContent(character)
  }
}
