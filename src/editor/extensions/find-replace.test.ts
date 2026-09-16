import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor } from '../../test/editor-harness'
import { buildPattern, findMatches, findPluginKey } from './find-replace'

let editor: Editor

beforeEach(() => {
  editor = createTestEditor('<p>The cat sat on the mat. The CAT returned.</p>')
})

afterEach(() => {
  editor.destroy()
})

const state = () => findPluginKey.getState(editor.state)

describe('buildPattern', () => {
  it('escapes regex metacharacters in a literal search', () => {
    const pattern = buildPattern({
      query: 'a.b',
      caseSensitive: true,
      wholeWord: false,
      regex: false,
    })
    expect(pattern?.test('axb')).toBe(false)
    expect(pattern?.test('a.b')).toBe(true)
  })

  it('returns null for a query that cannot compile as regex', () => {
    expect(
      buildPattern({ query: '([', caseSensitive: false, wholeWord: false, regex: true }),
    ).toBeNull()
  })

  it('returns null for an empty query', () => {
    expect(
      buildPattern({ query: '', caseSensitive: false, wholeWord: false, regex: false }),
    ).toBeNull()
  })
})

describe('findMatches', () => {
  it('finds every occurrence, case-insensitively by default', () => {
    const matches = findMatches(editor.state.doc, {
      query: 'cat',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    })
    expect(matches).toHaveLength(2)
  })

  it('respects case sensitivity', () => {
    const matches = findMatches(editor.state.doc, {
      query: 'CAT',
      caseSensitive: true,
      wholeWord: false,
      regex: false,
    })
    expect(matches).toHaveLength(1)
  })

  it('respects whole-word matching', () => {
    const matches = findMatches(editor.state.doc, {
      query: 'at',
      caseSensitive: false,
      wholeWord: true,
      regex: false,
    })
    expect(matches).toHaveLength(0)
  })

  it('does not hang on a zero-length regex match', () => {
    const matches = findMatches(editor.state.doc, {
      query: 'x*',
      caseSensitive: false,
      wholeWord: false,
      regex: true,
    })
    expect(matches).toEqual([])
  })

  it('maps matches to positions that select the right text', () => {
    const [first] = findMatches(editor.state.doc, {
      query: 'sat',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    })
    expect(first).toBeDefined()
    expect(editor.state.doc.textBetween(first?.from ?? 0, first?.to ?? 0)).toBe('sat')
  })

  it('does not match across a paragraph boundary', () => {
    const multi = createTestEditor('<p>foo</p><p>bar</p>')
    const matches = findMatches(multi.state.doc, {
      query: 'foobar',
      caseSensitive: false,
      wholeWord: false,
      regex: false,
    })
    expect(matches).toEqual([])
    multi.destroy()
  })
})

describe('navigation', () => {
  beforeEach(() => {
    editor.commands.setFindOptions({ query: 'cat' })
  })

  it('starts on the first match', () => {
    expect(state()?.activeIndex).toBe(0)
    expect(state()?.matches).toHaveLength(2)
  })

  it('wraps around on next', () => {
    editor.commands.findNext()
    expect(state()?.activeIndex).toBe(1)
    editor.commands.findNext()
    expect(state()?.activeIndex).toBe(0)
  })

  it('wraps around backwards on previous', () => {
    editor.commands.findPrevious()
    expect(state()?.activeIndex).toBe(1)
  })

  it('reports no matches for a query that is not present', () => {
    editor.commands.setFindOptions({ query: 'zebra' })
    expect(state()?.matches).toHaveLength(0)
    expect(state()?.activeIndex).toBe(-1)
  })

  it('refuses to navigate when there is nothing to navigate', () => {
    editor.commands.setFindOptions({ query: 'zebra' })
    expect(editor.commands.findNext()).toBe(false)
  })
})

describe('replace', () => {
  beforeEach(() => {
    editor.commands.setFindOptions({ query: 'cat' })
  })

  it('replaces only the active match', () => {
    editor.commands.replaceCurrent('dog')
    expect(editor.getText()).toBe('The dog sat on the mat. The CAT returned.')
  })

  it('replaces every match, back to front so positions stay valid', () => {
    editor.commands.replaceAll('dog')
    expect(editor.getText()).toBe('The dog sat on the mat. The dog returned.')
  })

  it('handles a replacement longer than the match', () => {
    editor.commands.replaceAll('elephant')
    expect(editor.getText()).toBe('The elephant sat on the mat. The elephant returned.')
  })

  it('re-scans after replacing, so the count drops', () => {
    editor.commands.replaceCurrent('dog')
    expect(state()?.matches).toHaveLength(1)
  })

  it('does nothing when there are no matches', () => {
    editor.commands.setFindOptions({ query: 'zebra' })
    expect(editor.commands.replaceAll('dog')).toBe(false)
  })

  it('leaves searching out of the document, so nothing changes without replace', () => {
    const before = editor.getHTML()
    editor.commands.setFindOptions({ query: 'the' })
    editor.commands.findNext()
    expect(editor.getHTML()).toBe(before)
  })
})
