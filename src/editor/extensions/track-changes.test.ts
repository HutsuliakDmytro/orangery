import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor, selectText } from '../../test/editor-harness'
import { useSettingsStore } from '../../store/settings-store'
import { useViewStore } from '../../store/view-store'

let editor: Editor

beforeEach(() => {
  useViewStore.setState({ trackChanges: true })
  useSettingsStore.setState({ authorName: 'Ada Lovelace' })
  editor = createTestEditor('<p>hello world</p>')
})

afterEach(() => {
  editor.destroy()
  useViewStore.setState({ trackChanges: false })
})

const text = () => editor.state.doc.textContent

/** The marks on the text at a position. */
const marksAt = (position: number): string[] =>
  editor.state.doc.nodeAt(position)?.marks.map((mark) => mark.type.name) ?? []

/**
 * Types a character the way the browser delivers one.
 *
 * When the handler says it dealt with the input, nothing more happens — the
 * browser does not then insert the text as well, and a helper that did would
 * be testing a path the editor never takes.
 */
function type(character: string): void {
  const { from, to } = editor.state.selection
  const handled = editor.view.someProp(
    'handleTextInput',
    (handler) => handler(editor.view, from, to, character, () => editor.state.tr) === true,
  )
  if (handled === true) return

  editor.view.dispatch(editor.state.tr.insertText(character, from, to))
}

/** Presses a key the way the browser delivers one. */
function press(key: string): boolean {
  return (
    editor.view.someProp('handleKeyDown', (handler) =>
      handler(editor.view, new KeyboardEvent('keydown', { key })),
    ) === true
  )
}

describe('recording what is typed', () => {
  it('marks new text as an insertion', () => {
    editor.commands.setTextSelection(1)
    type('X')

    expect(marksAt(1)).toContain('insertion')
  })

  it('signs it with the author and the day', () => {
    editor.commands.setTextSelection(1)
    type('X')

    const mark = editor.state.doc.nodeAt(1)?.marks.find((m) => m.type.name === 'insertion')
    expect(mark?.attrs['author']).toBe('Ada Lovelace')
    expect(() => new Date(String(mark?.attrs['date'])).toISOString()).not.toThrow()
  })

  it('leaves the text alone while the mode is off', () => {
    useViewStore.setState({ trackChanges: false })
    editor.commands.setTextSelection(1)
    type('X')

    expect(marksAt(1)).not.toContain('insertion')
  })
})

describe('recording what is deleted', () => {
  it('marks the text instead of removing it', () => {
    selectText(editor, 'hello')
    expect(press('Backspace')).toBe(true)

    expect(text()).toBe('hello world')
    expect(marksAt(1)).toContain('deletion')
  })

  it('takes out the character before the caret', () => {
    editor.commands.setTextSelection(6)
    press('Backspace')

    expect(text()).toBe('hello world')
    expect(marksAt(5)).toContain('deletion')
  })

  it('leaves the caret past what it struck through', () => {
    selectText(editor, 'hello')
    press('Backspace')

    expect(editor.state.selection.from).toBe(6)
  })

  it('removes text that was only just inserted, rather than recording it', () => {
    // It was never in the document being reviewed, so marking it deleted would
    // record a change to something that was itself a change.
    editor.commands.setTextSelection(1)
    type('X')
    press('Backspace')

    expect(text()).toBe('hello world')
  })

  it('deletes outright while the mode is off', () => {
    useViewStore.setState({ trackChanges: false })
    selectText(editor, 'hello')
    editor.commands.deleteSelection()

    expect(text()).toBe(' world')
  })
})

describe('typing over a selection', () => {
  it('records the old text as deleted and the new as inserted', () => {
    selectText(editor, 'hello')
    type('X')

    expect(text()).toContain('hello')
    expect(marksAt(1)).toContain('deletion')
    expect(text()).toContain('X')
  })
})

describe('settling the changes it recorded', () => {
  it('accepting leaves what was typed and drops what was struck through', () => {
    selectText(editor, 'hello')
    type('X')
    editor.commands.acceptRevisions(true)

    expect(text()).toBe('X world')
  })

  it('rejecting puts the document back as it was', () => {
    selectText(editor, 'hello')
    type('X')
    editor.commands.rejectRevisions(true)

    expect(text()).toBe('hello world')
  })
})

describe('one edit, one change', () => {
  it('carries on the change already being made rather than one per keystroke', () => {
    // A fresh id and timestamp per character would stop the text nodes merging,
    // and the file would carry a `w:ins` around every letter.
    editor.commands.setTextSelection(1)
    for (const character of 'added') type(character)

    let insertions = 0
    editor.state.doc.descendants((node) => {
      if (node.isText && node.marks.some((mark) => mark.type.name === 'insertion')) insertions += 1
      return true
    })

    expect(insertions).toBe(1)
  })

  it('starts a new change for a different author', () => {
    editor.commands.setTextSelection(1)
    type('A')

    useSettingsStore.setState({ authorName: 'Someone Else' })
    type('B')

    const authors = new Set<unknown>()
    editor.state.doc.descendants((node) => {
      for (const mark of node.marks) {
        if (mark.type.name === 'insertion') authors.add(mark.attrs['author'])
      }
      return true
    })

    expect(authors.size).toBe(2)
  })
})
