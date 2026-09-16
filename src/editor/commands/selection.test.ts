import { AllSelection, TextSelection } from '@tiptap/pm/state'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { createTestEditor } from '../../test/editor-harness'
import { normalizeBlockSelection, selectWholeDocument } from './selection'
import { runCommand } from './registry'

let editor: Editor

beforeEach(() => {
  editor = createTestEditor('<ul><li><p>one</p></li><li><p>two</p></li></ul>')
})

afterEach(() => {
  editor.destroy()
})

describe('selectWholeDocument', () => {
  it('produces a TextSelection, not an AllSelection', () => {
    selectWholeDocument(editor)
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
  })

  it('covers every text block in the document', () => {
    selectWholeDocument(editor)
    // The endpoints snap to the first and last text positions, which in a nested
    // list are inside the innermost paragraphs rather than at the document edges.
    const { from, to } = editor.state.selection
    expect(editor.state.doc.textBetween(from, to, '\n')).toBe('one\ntwo')
  })
})

describe('normalizeBlockSelection', () => {
  it('converts an AllSelection and reports that it did', () => {
    editor.commands.selectAll()
    expect(editor.state.selection).toBeInstanceOf(AllSelection)

    expect(normalizeBlockSelection(editor)).toBe(true)
    expect(editor.state.selection).toBeInstanceOf(TextSelection)
  })

  it('leaves an ordinary selection alone', () => {
    editor.commands.setTextSelection(3)
    expect(normalizeBlockSelection(editor)).toBe(false)
  })
})

describe('regression: select-all then remove the list', () => {
  it('removes a list after Mod+A, like Docs does', () => {
    runCommand('edit.select-all', { editor })
    runCommand('paragraph.bullet-list', { editor })

    expect(editor.getHTML()).toBe('<p>one</p><p>two</p>')
  })

  it('still works when the selection came from selectAll directly', () => {
    editor.commands.selectAll()
    runCommand('paragraph.bullet-list', { editor })

    expect(editor.getHTML()).toBe('<p>one</p><p>two</p>')
  })
})
