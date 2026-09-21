import { Editor } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { afterEach } from 'vitest'
import type { Extensions } from '@tiptap/core'

/**
 * The editors a test made, so they can be taken down again.
 *
 * An editor holds a ProseMirror view on a jsdom document and schedules work on
 * it. Left alive past the end of the file, that work lands after the
 * environment has gone and comes back as an unhandled error — in a full run,
 * where the timing is different, and never when the file is run alone. Which
 * is exactly the kind of failure people learn to ignore.
 */
const made: Editor[] = []

afterEach(() => {
  for (const editor of made.splice(0)) editor.destroy()
})

/**
 * A headless editor carrying this package and nothing else.
 *
 * Deliberately not the app's extension set: a test that passes only because
 * something in Docs happens to be loaded would go on passing while the same
 * extension misbehaves in Slides.
 */
export function createTextEditor(extensions: Extensions, content = '<p></p>'): Editor {
  const editor = new Editor({ extensions: [StarterKit, ...extensions], content })
  made.push(editor)
  return editor
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
