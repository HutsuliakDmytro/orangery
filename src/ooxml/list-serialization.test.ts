import { describe, expect, it } from 'vitest'
import { parseDocument } from './parse-document'
import { parseNumbering } from './numbering'
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

describe('reading a list back out of a document', () => {
  const wrap = (body: string) =>
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

  const item = (text: string, numId: number, level = 0) =>
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="${String(level)}"/><w:numId w:val="${String(numId)}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`

  const numbering = (format: string) =>
    parseNumbering(
      `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">` +
        `<w:abstractNum w:abstractNumId="0">` +
        `<w:lvl w:ilvl="0"><w:numFmt w:val="${format}"/></w:lvl>` +
        `<w:lvl w:ilvl="1"><w:numFmt w:val="${format}"/></w:lvl>` +
        `</w:abstractNum>` +
        `<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>` +
        `</w:numbering>`,
    )

  it('leaves the paragraphs alone when the definitions are not available', () => {
    // Nothing says whether the list is bulleted or numbered, and guessing shows
    // the wrong marker rather than none.
    const { doc } = parseDocument(wrap(item('one', 1)))
    expect(doc.content?.[0]?.type).toBe('paragraph')
  })

  it('groups a run of paragraphs into the list they belong to', () => {
    const { doc } = parseDocument(wrap(item('one', 1) + item('two', 1)), {
      numbering: numbering('bullet'),
    })

    expect(doc.content).toHaveLength(1)
    expect(doc.content?.[0]?.type).toBe('bulletList')
    expect(doc.content?.[0]?.content).toHaveLength(2)
  })

  it('tells a numbered list from a bulleted one by its definition', () => {
    const { doc } = parseDocument(wrap(item('one', 1)), { numbering: numbering('decimal') })
    expect(doc.content?.[0]?.type).toBe('orderedList')
  })

  it('nests by the level each paragraph declares', () => {
    const { doc } = parseDocument(wrap(item('one', 1) + item('deep', 1, 1)), {
      numbering: numbering('bullet'),
    })

    const outer = doc.content?.[0]
    expect(outer?.content?.[0]?.content?.[1]?.type).toBe('bulletList')
  })

  it('ends the list at the first paragraph that is not part of it', () => {
    const body = item('one', 1) + '<w:p><w:r><w:t>after</w:t></w:r></w:p>' + item('two', 1)
    const { doc } = parseDocument(wrap(body), { numbering: numbering('bullet') })

    expect(doc.content?.map((node) => node.type)).toEqual([
      'bulletList',
      'paragraph',
      'bulletList',
    ])
  })

  it('round-trips without adding a definition of its own', () => {
    const source = wrap(item('one', 1) + item('two', 1))
    const { doc } = parseDocument(source, { numbering: numbering('bullet') })

    const xml = serializeDocument(doc, {
      documentAttributes: {},
      sectionProperties: null,
      alwaysPreserveSpace: false,
      // An allocator is offered and must go unused: the paragraphs already say
      // which definition they belong to.
      allocateNumbering: () => 99,
    })

    expect(xml).toContain('<w:numId w:val="1"/>')
    expect(xml).not.toContain('w:val="99"')
  })
})
