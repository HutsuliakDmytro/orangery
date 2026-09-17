import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor, selectAll } from '../../../test/editor-harness'
import { runCommand } from '@orangery/ui-kit'

let editor: Editor

beforeEach(() => {
  editor = createTestEditor('<p>start</p>')
})

afterEach(() => {
  editor.destroy()
})

const run = (id: string) => runCommand(id, { editor })

describe('history grouping', () => {
  it('undoes a run of typing as one step, not one character at a time', () => {
    // Inserted in a single transaction burst, which is how typing arrives inside
    // the history extension's grouping window.
    editor.commands.insertContentAt(6, 'abc')
    expect(editor.getText()).toBe('startabc')

    run('edit.undo')
    expect(editor.getText()).toBe('start')
  })

  it('keeps separate edits as separate undo steps', () => {
    editor.commands.insertContentAt(6, 'one')
    editor.commands.setTextSelection(1)
    editor.commands.insertContentAt(1, 'two')

    run('edit.undo')
    expect(editor.getText()).toBe('startone')

    run('edit.undo')
    expect(editor.getText()).toBe('start')
  })

  it('redoes what was undone', () => {
    editor.commands.insertContentAt(6, 'abc')
    run('edit.undo')
    run('edit.redo')
    expect(editor.getText()).toBe('startabc')
  })

  it('reports undo as unavailable on a fresh document', () => {
    expect(run('edit.undo')).toBe(false)
  })

  it('reports redo as unavailable until something is undone', () => {
    editor.commands.insertContentAt(6, 'abc')
    expect(run('edit.redo')).toBe(false)
  })
})

describe('select all', () => {
  it('selects the whole document text', () => {
    editor.commands.setContent('<p>one</p><p>two</p>')
    run('edit.select-all')
    const { from, to } = editor.state.selection
    expect(editor.state.doc.textBetween(from, to, '\n')).toBe('one\ntwo')
  })

  it('leaves the document untouched', () => {
    const before = editor.getHTML()
    selectAll(editor)
    expect(editor.getHTML()).toBe(before)
  })
})
