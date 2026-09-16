import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor } from '../../test/editor-harness'
import { applyFormat, clearFormat, copyFormat, heldFormat } from './format-painter'

let editor: Editor

beforeEach(() => {
  editor = createTestEditor()
  clearFormat()
})

afterEach(() => {
  editor.destroy()
})

/** Selects the characters between two document positions. */
const select = (from: number, to: number) => {
  editor.commands.setTextSelection({ from, to })
}

/**
 * The marks on the text at a position.
 *
 * Read by position rather than by the text itself: painting one run to match
 * another merges them into a single node, so there is no longer a node whose
 * text is the piece that was painted.
 */
const marksAt = (position: number): string[] =>
  editor.state.doc.nodeAt(position)?.marks.map((mark) => mark.type.name) ?? []

describe('copyFormat', () => {
  it('holds the marks at the cursor', () => {
    editor.commands.setContent('<p><strong>bold</strong> plain</p>')
    select(2, 2)

    expect(copyFormat(editor).marks.map((mark) => mark.type)).toContain('bold')
  })

  it('holds the mark attributes, not just the name', () => {
    editor.commands.setContent('<p><span style="color: #FF0000">red</span></p>')
    select(2, 4)

    const textStyle = copyFormat(editor).marks.find((mark) => mark.type === 'textStyle')
    expect(textStyle?.attrs['color']).toBe('rgb(255, 0, 0)')
  })

  it('holds the paragraph formatting', () => {
    editor.commands.setContent('<p>text</p>')
    editor.commands.updateAttributes('paragraph', { textAlign: 'center', indentLeft: 36 })

    const format = copyFormat(editor)
    expect(format.block['textAlign']).toBe('center')
    expect(format.block['indentLeft']).toBe(36)
  })

  it('does not pick up the source run’s preserved properties', () => {
    // Painting those onto other text would give two runs the same identity and
    // the same preserved `w:rPr`.
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [
                { type: 'bold' },
                { type: 'preservedRunProperties', attrs: { runKey: 'r1', xml: '<w:noProof/>' } },
              ],
            },
          ],
        },
      ],
    })
    select(1, 2)

    expect(copyFormat(editor).marks.map((mark) => mark.type)).toEqual(['bold'])
  })

  it('does not pick up a hyperlink', () => {
    editor.commands.setContent('<p><a href="https://example.com">link</a></p>')
    select(1, 5)

    expect(copyFormat(editor).marks.map((mark) => mark.type)).not.toContain('link')
  })
})

describe('applyFormat', () => {
  it('does nothing when no formatting is held', () => {
    editor.commands.setContent('<p>text</p>')
    expect(applyFormat(editor)).toBe(false)
  })

  it('paints the marks onto the selection', () => {
    editor.commands.setContent('<p><strong>bold</strong>plain</p>')
    select(2, 3)
    copyFormat(editor)

    select(5, 10)
    applyFormat(editor)

    expect(marksAt(6)).toContain('bold')
  })

  it('replaces the formatting that was there rather than adding to it', () => {
    editor.commands.setContent('<p><strong>bold</strong><em>italic</em></p>')
    select(2, 3)
    copyFormat(editor)

    select(5, 11)
    applyFormat(editor)

    expect(marksAt(6)).toEqual(['bold'])
    expect(editor.getHTML()).not.toContain('<em>')
  })

  it('leaves the preserved run properties of the text painted over', () => {
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a', marks: [{ type: 'bold' }] },
            {
              type: 'text',
              text: 'bb',
              marks: [{ type: 'preservedRunProperties', attrs: { runKey: 'r2' } }],
            },
          ],
        },
      ],
    })

    select(1, 2)
    copyFormat(editor)
    select(2, 4)
    applyFormat(editor)

    expect(marksAt(3)).toContain('preservedRunProperties')
  })

  it('paints the paragraph formatting', () => {
    editor.commands.setContent('<p>one</p><p>two</p>')
    editor.commands.setTextSelection(2)
    editor.commands.updateAttributes('paragraph', { textAlign: 'right', spaceAfter: 12 })
    copyFormat(editor)

    editor.commands.setTextSelection(8)
    applyFormat(editor)

    const attrs = editor.getAttributes('paragraph')
    expect(attrs['textAlign']).toBe('right')
    expect(attrs['spaceAfter']).toBe(12)
  })

  it('leaves the block type alone, so a paragraph does not become a heading', () => {
    editor.commands.setContent('<h2>title</h2><p>body</p>')
    editor.commands.setTextSelection(2)
    copyFormat(editor)

    editor.commands.setTextSelection(10)
    applyFormat(editor)

    expect(editor.getHTML()).toContain('<p')
  })

  it('can be applied more than once', () => {
    editor.commands.setContent('<p><strong>b</strong>one two</p>')
    select(1, 2)
    copyFormat(editor)

    select(2, 5)
    applyFormat(editor)
    select(5, 9)
    applyFormat(editor)

    expect(heldFormat()).not.toBeNull()
  })
})
