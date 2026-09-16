import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor } from '../test/editor-harness'

/**
 * Input rules fire on typed text, so each case types the trigger through
 * ProseMirror's input handler rather than calling a command.
 */
let editor: Editor

beforeEach(() => {
  editor = createTestEditor('<p></p>')
})

afterEach(() => {
  editor.destroy()
})

function type(text: string): void {
  const { view } = editor
  for (const char of text) {
    const { from, to } = view.state.selection
    // `deflt` is what ProseMirror would have done without a handler; input rules
    // ignore it, but the prop signature requires it.
    const deflt = () => view.state.tr.insertText(char, from, to)
    view.someProp('handleTextInput', (handler) => handler(view, from, to, char, deflt))

    // No rule consumed the keystroke, so insert it the ordinary way.
    if (view.state.selection.from === from) {
      view.dispatch(deflt())
    }
  }
}

describe('input rules', () => {
  it('turns "# " into a heading', () => {
    type('# Title')
    expect(editor.getHTML()).toBe('<h1>Title</h1>')
  })

  it('turns "## " into a second-level heading', () => {
    type('## Section')
    expect(editor.getHTML()).toBe('<h2>Section</h2>')
  })

  it('turns "- " into a bulleted list', () => {
    type('- item')
    expect(editor.isActive('bulletList')).toBe(true)
  })

  it('turns "1. " into a numbered list', () => {
    type('1. item')
    expect(editor.isActive('orderedList')).toBe(true)
  })

  it('turns "> " into a blockquote', () => {
    type('> quoted')
    expect(editor.isActive('blockquote')).toBe(true)
  })

  it('turns "**text**" into bold', () => {
    type('**bold**')
    expect(editor.getHTML()).toContain('<strong>bold</strong>')
  })

  it('turns "*text*" into italic', () => {
    type('*slanted*')
    expect(editor.getHTML()).toContain('<em>slanted</em>')
  })

  it('turns "`code`" into inline code', () => {
    type('`snippet`')
    expect(editor.getHTML()).toContain('<code>snippet</code>')
  })

  it('turns "---" into a horizontal rule', () => {
    type('--- ')
    expect(editor.getHTML()).toContain('<hr>')
  })

  it('autolinks a typed URL', () => {
    type('see https://example.com ')
    expect(editor.getHTML()).toContain('href="https://example.com"')
  })

  it('leaves ordinary text alone', () => {
    type('just words')
    expect(editor.getHTML()).toBe('<p>just words</p>')
  })
})
