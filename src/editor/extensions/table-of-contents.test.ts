import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor } from '../../test/editor-harness'
import { entriesFromOutline } from './table-of-contents'
import { buildOutline } from '../outline'

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
