import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Editor } from '@tiptap/core'
import { createTestEditor } from '../test/editor-harness'
import { buildOutline } from './outline'

let editor: Editor

afterEach(() => {
  editor.destroy()
})

const outlineOf = (html: string) => {
  editor = createTestEditor(html)
  return buildOutline(editor.state.doc)
}

describe('buildOutline', () => {
  beforeEach(() => {
    editor = createTestEditor('<p></p>')
  })

  it('lists headings in document order', () => {
    const outline = outlineOf('<h1>One</h1><p>body</p><h2>Two</h2>')
    expect(outline.map((entry) => entry.text)).toEqual(['One', 'Two'])
  })

  it('records the heading level', () => {
    expect(outlineOf('<h3>Three</h3>')[0]?.level).toBe(3)
  })

  it('ignores paragraphs', () => {
    expect(outlineOf('<p>not a heading</p>')).toEqual([])
  })

  it('records a position that resolves inside the document', () => {
    editor = createTestEditor('<p>intro</p><h1>Title</h1>')
    const [entry] = buildOutline(editor.state.doc)

    expect(entry?.position).toBeGreaterThan(0)
    expect(entry?.position).toBeLessThan(editor.state.doc.content.size)
  })

  it('trims heading text', () => {
    expect(outlineOf('<h1>  Padded  </h1>')[0]?.text).toBe('Padded')
  })

  it('nests a lower heading under a higher one', () => {
    const outline = outlineOf('<h1>One</h1><h2>Two</h2>')
    expect(outline.map((entry) => entry.depth)).toEqual([0, 1])
  })

  it('does not indent a document that starts at Heading 2', () => {
    const outline = outlineOf('<h2>One</h2><h2>Two</h2>')
    expect(outline.map((entry) => entry.depth)).toEqual([0, 0])
  })

  it('collapses a skipped level rather than leaving a gap', () => {
    const outline = outlineOf('<h2>One</h2><h4>Deep</h4>')
    expect(outline.map((entry) => entry.depth)).toEqual([0, 1])
  })

  it('returns to the outer level after a nested run', () => {
    const outline = outlineOf('<h1>A</h1><h2>B</h2><h1>C</h1>')
    expect(outline.map((entry) => entry.depth)).toEqual([0, 1, 0])
  })

  it('handles an empty document', () => {
    expect(outlineOf('<p></p>')).toEqual([])
  })
})
