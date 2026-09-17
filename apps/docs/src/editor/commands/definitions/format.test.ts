import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor, selectAll, selectText } from '../../../test/editor-harness'
import { runCommand } from '../registry'

let editor: Editor

beforeEach(() => {
  editor = createTestEditor()
})

afterEach(() => {
  editor.destroy()
})

const run = (id: string) => runCommand(id, { editor })

describe('character marks', () => {
  const cases: { id: string; tag: string }[] = [
    { id: 'format.bold', tag: 'strong' },
    { id: 'format.italic', tag: 'em' },
    { id: 'format.underline', tag: 'u' },
    { id: 'format.strike', tag: 's' },
    { id: 'format.superscript', tag: 'sup' },
    { id: 'format.subscript', tag: 'sub' },
  ]

  it.each(cases)('$id wraps the selection in <$tag>', ({ id, tag }) => {
    selectAll(editor)
    expect(run(id)).toBe(true)
    expect(editor.getHTML()).toBe(`<p><${tag}>hello world</${tag}></p>`)
  })

  it.each(cases)('$id toggles back off, restoring the original document', ({ id }) => {
    const before = editor.getHTML()
    selectAll(editor)
    run(id)
    run(id)
    expect(editor.getHTML()).toBe(before)
  })

  it('applies a mark to part of the text only', () => {
    selectText(editor, 'hello')
    run('format.bold')
    expect(editor.getHTML()).toBe('<p><strong>hello</strong> world</p>')
  })

  it('reports active state from the registry', () => {
    selectAll(editor)
    run('format.bold')
    expect(editor.isActive('bold')).toBe(true)
  })
})

describe('font size', () => {
  it('steps up through the preset ladder', () => {
    selectAll(editor)
    run('format.increase-font-size')
    expect(editor.getHTML()).toContain('font-size: 12pt')
  })

  it('steps down through the preset ladder', () => {
    selectAll(editor)
    run('format.decrease-font-size')
    expect(editor.getHTML()).toContain('font-size: 10.5pt')
  })

  it('steps relative to the current size, not the default', () => {
    selectAll(editor)
    editor.commands.setFontSize(24)
    run('format.increase-font-size')
    expect(editor.getHTML()).toContain('font-size: 28pt')
  })

  it('stops at the top of the ladder', () => {
    selectAll(editor)
    editor.commands.setFontSize(72)
    run('format.increase-font-size')
    expect(editor.getHTML()).toContain('font-size: 72pt')
  })
})

describe('clear formatting', () => {
  it('removes every mark from the selection', () => {
    selectAll(editor)
    run('format.bold')
    run('format.italic')
    editor.commands.setColor('#FF0000')

    run('format.clear')
    expect(editor.getHTML()).toBe('<p>hello world</p>')
  })

  it('resets the block type back to a paragraph', () => {
    editor.commands.setContent('<h2>a heading</h2>')
    selectAll(editor)
    run('format.clear')
    expect(editor.getHTML()).toBe('<p>a heading</p>')
  })
})

describe('colour and highlight', () => {
  it('sets and clears the text colour', () => {
    selectAll(editor)
    editor.commands.setColor('#FF7A00')
    // The attribute keeps the hex; jsdom rewrites the rendered style to rgb().
    expect(editor.getAttributes('textStyle')['color']).toBe('#FF7A00')

    editor.commands.unsetColor()
    expect(editor.getHTML()).toBe('<p>hello world</p>')
  })

  it('sets a highlight and removes it through the registry command', () => {
    selectAll(editor)
    editor.commands.setHighlight({ color: '#FFFF00' })
    expect(editor.getHTML()).toContain('#FFFF00')

    expect(run('format.remove-highlight')).toBe(true)
    expect(editor.getHTML()).toBe('<p>hello world</p>')
  })

  it('refuses to remove a highlight that is not there', () => {
    selectAll(editor)
    expect(run('format.remove-highlight')).toBe(false)
  })
})

describe('font family', () => {
  it('writes the family name into the document', () => {
    selectAll(editor)
    editor.commands.setFontFamily('Georgia')
    expect(editor.getHTML()).toContain('font-family: Georgia')
  })
})
