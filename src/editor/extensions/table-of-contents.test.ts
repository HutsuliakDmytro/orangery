import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor } from '../../test/editor-harness'
import { entriesFromOutline } from './table-of-contents'
import { buildOutline } from '../outline'
import { useViewStore } from '../../store/view-store'
import { runCommand } from '../commands/registry'

let editor: Editor

beforeEach(() => {
  editor = createTestEditor('<h1>One</h1><p>body</p><h2>Two</h2><h4>Deep</h4>')
})

afterEach(() => {
  editor.destroy()
})

function tocAttrs(): Record<string, unknown> | null {
  let found: Record<string, unknown> | null = null
  editor.state.doc.descendants((node) => {
    if (node.type.name === 'tableOfContents') found = node.attrs
    return found === null
  })
  return found
}

describe('insertTableOfContents', () => {
  it('inserts a block', () => {
    editor.commands.insertTableOfContents()
    expect(tocAttrs()).not.toBeNull()
  })

  it('starts empty until refreshed', () => {
    editor.commands.insertTableOfContents()
    expect(tocAttrs()?.['entries']).toEqual([])
  })
})

describe('refreshTableOfContents', () => {
  it('fills in the document headings', () => {
    editor.commands.insertTableOfContents()
    editor.commands.refreshTableOfContents()

    const entries = tocAttrs()?.['entries']
    expect(
      Array.isArray(entries) ? entries.map((entry: { text: string }) => entry.text) : [],
    ).toEqual(['One', 'Two'])
  })

  it("honours the level limit, like Word's \\o switch", () => {
    editor.commands.insertTableOfContents()
    editor.commands.refreshTableOfContents()

    // Heading 4 is past the default limit of 3.
    const entries = tocAttrs()?.['entries']
    expect(Array.isArray(entries) ? entries.length : 0).toBe(2)
  })

  it('picks up headings added after the block was inserted', () => {
    editor.commands.insertTableOfContents()
    editor.commands.refreshTableOfContents()

    editor.commands.insertContentAt(editor.state.doc.content.size, '<h1>Later</h1>')
    editor.commands.refreshTableOfContents()

    const entries = tocAttrs()?.['entries']
    expect(
      Array.isArray(entries) ? entries.map((entry: { text: string }) => entry.text) : [],
    ).toContain('Later')
  })

  it('reports failure when there is no table of contents to refresh', () => {
    expect(editor.commands.refreshTableOfContents()).toBe(false)
  })

  it('survives a document with no headings', () => {
    const plain = createTestEditor('<p>just text</p>')
    plain.commands.insertTableOfContents()

    expect(plain.commands.refreshTableOfContents()).toBe(true)
    plain.destroy()
  })
})

describe('entriesFromOutline', () => {
  it('reuses the outline the sidebar builds', () => {
    const outline = buildOutline(editor.state.doc)
    expect(entriesFromOutline(outline).map((entry) => entry.text)).toEqual(['One', 'Two'])
  })

  it('applies its own level limit', () => {
    const outline = buildOutline(editor.state.doc)
    expect(entriesFromOutline(outline, 1).map((entry) => entry.text)).toEqual(['One'])
  })
})

describe('numbered entries', () => {
  const numbered = '<h1>One</h1><h2>Under</h2><h1>Two</h1>'

  /** The entries of the table, in the order they were collected. */
  const numbersOf = (): (string | undefined)[] => {
    const entries = tocAttrs()?.['entries']
    return (Array.isArray(entries) ? (entries as { number?: string }[]) : []).map(
      (entry) => entry.number,
    )
  }

  const rebuild = () => {
    editor.commands.setContent(numbered)
    editor.chain().insertTableOfContents().refreshTableOfContents().run()
  }

  afterEach(() => {
    useViewStore.setState({ headingNumbering: null })
  })

  it('leaves the entries bare while the headings are unnumbered', () => {
    rebuild()
    expect(numbersOf()).toEqual([undefined, undefined, undefined])
  })

  it('carries the same numbers the headings are drawn with', () => {
    useViewStore.setState({ headingNumbering: 'decimal' })
    rebuild()

    // The numbers come from the computation that draws them on the page, so an
    // entry cannot be numbered differently from its own heading.
    expect(numbersOf()).toEqual(['1.', '1.1.', '2.'])
  })

  it('follows a change of scheme on the next refresh', () => {
    useViewStore.setState({ headingNumbering: 'decimal' })
    rebuild()

    useViewStore.setState({ headingNumbering: 'outline' })
    editor.commands.refreshTableOfContents()

    expect(numbersOf()).toEqual(['I.', 'A.', 'II.'])
  })

  it('renumbers when a heading is added in front of them', () => {
    useViewStore.setState({ headingNumbering: 'decimal' })
    rebuild()

    editor.commands.setContent(`<h1>New</h1>${numbered}`)
    editor.chain().insertTableOfContents().refreshTableOfContents().run()

    expect(numbersOf()).toEqual(['1.', '2.', '2.1.', '3.'])
  })

  it('draws the number in front of the entry text', () => {
    useViewStore.setState({ headingNumbering: 'decimal' })
    rebuild()

    expect(editor.getHTML()).toContain('1.1. Under')
  })
})

describe('inserting and filling in one go', () => {
  it('fills the table the command inserts, without a second step', () => {
    // The command chains the insert and the refresh, so the refresh has to see
    // the table the insert has only just added.
    editor.commands.setContent('<h1>One</h1><h2>Under</h2>')
    runCommand('insert.table-of-contents', { editor })

    const entries = tocAttrs()?.['entries']
    expect(Array.isArray(entries) ? entries : []).toHaveLength(2)
  })
})
