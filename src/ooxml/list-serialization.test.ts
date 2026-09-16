import { describe, expect, it } from 'vitest'
import { runCommand } from '../editor/commands/registry'
import { createTestEditor, selectAll } from '../test/editor-harness'
import type { ProseMirrorNodeJson } from './prosemirror-json'
import { serializeDocument } from './serialize-document'

/**
 * Lists made in the editor must survive a save.
 *
 * ProseMirror nests them; OOXML has no list element at all. Before this was
 * handled the serialiser met an unknown block and dropped it — which meant
 * creating a list and saving produced an empty document.
 */

function docOf(html: string, commandId?: string): ProseMirrorNodeJson {
  const editor = createTestEditor(html)
  if (commandId !== undefined) {
    selectAll(editor)
    runCommand(commandId, { editor })
  }
  const doc = editor.getJSON() as ProseMirrorNodeJson
  editor.destroy()
  return doc
}

const serialize = (doc: ProseMirrorNodeJson, allocate = true) => {
  let next = 1
  return serializeDocument(doc, {
    documentAttributes: {},
    sectionProperties: null,
    ...(allocate ? { allocateNumbering: () => next++ } : {}),
  })
}

describe('a list created in the editor', () => {
  it('is not dropped on save', () => {
    const xml = serialize(docOf('<p>first</p>', 'paragraph.bullet-list'))
    expect(xml).toContain('first')
  })

  it('becomes paragraphs carrying a numbering reference', () => {
    const xml = serialize(docOf('<p>first</p>', 'paragraph.bullet-list'))
    expect(xml).toContain('w:numPr')
    expect(xml).toContain('w:numId')
  })

  it('keeps every item', () => {
    const xml = serialize(docOf('<ul><li><p>one</p></li><li><p>two</p></li></ul>'))
    expect(xml).toContain('one')
    expect(xml).toContain('two')
  })

  it('gives every item of one list the same numbering id', () => {
    const xml = serialize(docOf('<ul><li><p>one</p></li><li><p>two</p></li></ul>'))
    const ids = [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/gu)].map((match) => match[1])

    expect(ids).toHaveLength(2)
    expect(new Set(ids).size).toBe(1)
  })

  it('gives two separate lists different ids', () => {
    const xml = serialize(docOf('<ul><li><p>a</p></li></ul><ol><li><p>b</p></li></ol>'))
    const ids = [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/gu)].map((match) => match[1])

    expect(new Set(ids).size).toBe(2)
  })

  it('records depth as the level, keeping one id for the whole list', () => {
    const xml = serialize(docOf('<ul><li><p>one</p><ul><li><p>nested</p></li></ul></li></ul>'))

    const levels = [...xml.matchAll(/<w:ilvl w:val="(\d+)"\/>/gu)].map((match) => match[1])
    const ids = [...xml.matchAll(/<w:numId w:val="(\d+)"\/>/gu)].map((match) => match[1])

    expect(levels).toEqual(['0', '1'])
    expect(new Set(ids).size).toBe(1)
  })

  it('handles a numbered list', () => {
    const xml = serialize(docOf('<ol><li><p>one</p></li></ol>'))
    expect(xml).toContain('w:numPr')
    expect(xml).toContain('one')
  })

  it('handles a checklist', () => {
    const doc = docOf('<p>task</p>', 'paragraph.task-list')
    expect(serialize(doc)).toContain('task')
  })

  it('keeps the text when there is nowhere to add a definition', () => {
    // Without an allocator the paragraphs are written plain rather than with a
    // reference to a numId that does not exist.
    const xml = serialize(docOf('<ul><li><p>one</p></li></ul>'), false)

    expect(xml).toContain('one')
    expect(xml).not.toContain('w:numPr')
  })

  it('does not carry a list numbering into a table inside it', () => {
    const doc: ProseMirrorNodeJson = {
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'table',
                  content: [
                    {
                      type: 'tableRow',
                      content: [
                        {
                          type: 'tableCell',
                          content: [
                            { type: 'paragraph', content: [{ type: 'text', text: 'cell' }] },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }

    const xml = serialize(doc)
    expect(xml).toContain('cell')
    // The cell paragraph is not part of the list.
    expect(xml.slice(xml.indexOf('<w:tbl'))).not.toContain('w:numPr')
  })
})
