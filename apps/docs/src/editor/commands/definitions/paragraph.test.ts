import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor, selectAll } from '../../../test/editor-harness'
import { INDENT_STEP_PT } from '@orangery/editor-text'
import { describeCommands, runCommand } from '../registry'

let editor: Editor

beforeEach(() => {
  editor = createTestEditor()
})

afterEach(() => {
  editor.destroy()
})

const run = (id: string) => runCommand(id, { editor })
const blockAttributes = () =>
  editor.getAttributes(editor.isActive('heading') ? 'heading' : 'paragraph')

describe('paragraph styles', () => {
  it.each([1, 2, 3, 4, 5, 6])('applies heading level %i', (level) => {
    selectAll(editor)
    run(`paragraph.heading-${String(level)}`)
    expect(editor.getHTML()).toContain(`<h${String(level)}`)
  })

  it('returns a heading to normal text', () => {
    selectAll(editor)
    run('paragraph.heading-2')
    run('paragraph.normal')
    expect(editor.getHTML()).toBe('<p>hello world</p>')
  })

  it('applies Title as a paragraph style, not a heading', () => {
    selectAll(editor)
    run('paragraph.title')
    expect(editor.isActive('heading')).toBe(false)
    expect(editor.getAttributes('paragraph')['styleId']).toBe('Title')
    expect(editor.getHTML()).toContain('data-style-id="Title"')
  })

  it('replaces a heading when Title is applied over it', () => {
    selectAll(editor)
    run('paragraph.heading-1')
    run('paragraph.title')
    expect(editor.getHTML()).not.toContain('<h1')
    expect(editor.getAttributes('paragraph')['styleId']).toBe('Title')
  })

  it('clears the named style when returning to normal', () => {
    selectAll(editor)
    run('paragraph.subtitle')
    run('paragraph.normal')
    expect(editor.getAttributes('paragraph')['styleId']).toBeNull()
  })
})

describe('alignment', () => {
  it.each(['left', 'center', 'right', 'justify'])('sets %s alignment', (value) => {
    selectAll(editor)
    run(`paragraph.align-${value}`)
    expect(editor.isActive({ textAlign: value })).toBe(true)
  })

  it('reports the active alignment through the registry', () => {
    selectAll(editor)
    run('paragraph.align-center')
    expect(editor.isActive({ textAlign: 'right' })).toBe(false)
  })
})

describe('indentation', () => {
  it('indents a plain paragraph by one Word tab stop', () => {
    selectAll(editor)
    run('paragraph.indent')
    expect(blockAttributes()['indentLeft']).toBe(INDENT_STEP_PT)
  })

  it('accumulates repeated indents', () => {
    selectAll(editor)
    run('paragraph.indent')
    run('paragraph.indent')
    expect(blockAttributes()['indentLeft']).toBe(INDENT_STEP_PT * 2)
  })

  it('outdents back to no indent at all', () => {
    selectAll(editor)
    run('paragraph.indent')
    run('paragraph.outdent')
    expect(blockAttributes()['indentLeft']).toBeNull()
  })

  it('never outdents past zero', () => {
    selectAll(editor)
    run('paragraph.outdent')
    expect(blockAttributes()['indentLeft']).toBeNull()
  })

  it('nests a list item instead of widening its margin', () => {
    editor.commands.setContent('<ul><li><p>one</p></li><li><p>two</p></li></ul>')
    editor.commands.setTextSelection(editor.state.doc.content.size - 3)

    run('paragraph.indent')
    expect(editor.getHTML()).toContain('<ul><li><p>one</p><ul><li><p>two</p>')
  })
})

describe('lists', () => {
  it('toggles a bulleted list on and off', () => {
    selectAll(editor)
    run('paragraph.bullet-list')
    expect(editor.isActive('bulletList')).toBe(true)

    run('paragraph.bullet-list')
    expect(editor.getHTML()).toBe('<p>hello world</p>')
  })

  it('toggles a numbered list', () => {
    selectAll(editor)
    run('paragraph.ordered-list')
    expect(editor.isActive('orderedList')).toBe(true)
  })

  it('toggles a checklist and renders checkbox markup', () => {
    selectAll(editor)
    run('paragraph.task-list')
    expect(editor.isActive('taskList')).toBe(true)
    expect(editor.getHTML()).toContain('data-type="taskList"')
  })

  it('switches a bulleted list to a numbered one', () => {
    selectAll(editor)
    run('paragraph.bullet-list')
    run('paragraph.ordered-list')
    expect(editor.isActive('orderedList')).toBe(true)
    expect(editor.isActive('bulletList')).toBe(false)
  })
})

describe('blocks', () => {
  it('toggles a blockquote', () => {
    selectAll(editor)
    run('insert.blockquote')
    expect(editor.isActive('blockquote')).toBe(true)
  })

  it('inserts a horizontal rule', () => {
    selectAll(editor)
    run('insert.horizontal-rule')
    expect(editor.getHTML()).toContain('<hr>')
  })

  it('inserts a page break as a node that survives serialisation', () => {
    editor.commands.setTextSelection(editor.state.doc.content.size)
    run('insert.page-break')
    expect(editor.getHTML()).toContain('data-page-break="true"')
    expect(editor.getJSON()).toMatchObject({
      content: expect.arrayContaining([expect.objectContaining({ type: 'pageBreak' })]) as unknown,
    })
  })

  it('leaves a typable paragraph after a page break', () => {
    editor.commands.setTextSelection(editor.state.doc.content.size)
    run('insert.page-break')
    editor.commands.insertContent('after')
    expect(editor.getText()).toContain('after')
  })
})

describe('spacing', () => {
  it('sets a line height multiplier', () => {
    selectAll(editor)
    editor.commands.setLineHeight(1.5)
    expect(blockAttributes()['lineHeight']).toBe(1.5)
  })

  it('sets space before and after in points', () => {
    selectAll(editor)
    editor.commands.setParagraphSpacing({ before: 12, after: 6 })
    expect(blockAttributes()['spaceBefore']).toBe(12)
    expect(blockAttributes()['spaceAfter']).toBe(6)
  })

  it('clears spacing back to the document default', () => {
    selectAll(editor)
    editor.commands.setParagraphSpacing({ before: 12, after: 6 })
    editor.commands.unsetParagraphSpacing()
    expect(blockAttributes()['spaceBefore']).toBeNull()
  })
})

describe('pagination', () => {
  it.each([
    ['paragraph.keep-next', 'keepNext'],
    ['paragraph.keep-lines', 'keepLines'],
    ['paragraph.page-break-before', 'pageBreakBefore'],
    ['paragraph.widow-control', 'widowControl'],
  ])('%s toggles %s on', (id, attribute) => {
    run(id)
    expect(blockAttributes()[attribute]).toBe(true)
  })

  it('writes an explicit off rather than clearing the property', () => {
    // Word turns widow control on by default, so clearing it would mean "on".
    run('paragraph.widow-control')
    run('paragraph.widow-control')
    expect(blockAttributes()['widowControl']).toBe(false)
  })

  it('tells the menu it is a toggle, and whether it is on', () => {
    // Without this the native menu draws a plain item, and a toggle with no
    // tick gives no way to see its state.
    const describe = () =>
      describeCommands({ editor }).find((command) => command.id === 'paragraph.keep-next')

    expect(describe()?.active).toBe(false)
    run('paragraph.keep-next')
    expect(describe()?.active).toBe(true)
  })

  it('leaves a command that is not a toggle without a state', () => {
    const insert = describeCommands({ editor }).find(
      (command) => command.id === 'insert.horizontal-rule',
    )
    expect(insert?.active).toBeNull()
  })

  it('applies to a heading as well as a paragraph', () => {
    selectAll(editor)
    run('paragraph.heading-2')
    run('paragraph.keep-next')
    expect(editor.getAttributes('heading')['keepNext']).toBe(true)
  })
})
