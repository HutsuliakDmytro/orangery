import { CONTENT_TYPES_PART, getPartText, parseRelationships } from '@orangery/ooxml-core'
import { readDocxPackage } from '../ooxml/parts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FOOTNOTES_PART, parseFootnotes, separatorFootnotes } from '../ooxml/footnotes'
import type { ProseMirrorNodeJson } from '../ooxml/prosemirror-json'
import { collectFootnotes, writeFootnotes } from './footnotes-session'
import { DOCUMENT_RELS_PART } from './media'

const FIXTURES = join(process.cwd(), 'tests/fixtures/docx/synthetic')

const fixture = async () => readDocxPackage(await readFile(join(FIXTURES, 'plain-paragraphs.docx')))

function docWith(notes: { id: number; text: string }[]): ProseMirrorNodeJson {
  return {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: 'Body' },
          ...notes.map((note) => ({
            type: 'footnote',
            attrs: { footnoteId: note.id, text: note.text },
          })),
        ],
      },
    ],
  }
}

describe('collectFootnotes', () => {
  it('finds markers in document order', () => {
    const notes = collectFootnotes(
      docWith([
        { id: 2, text: 'Second' },
        { id: 1, text: 'First' },
      ]),
    )
    expect(notes.map((note) => note.id)).toEqual([2, 1])
  })

  it('reads the note text from the marker', () => {
    expect(collectFootnotes(docWith([{ id: 1, text: 'See page 4' }]))[0]?.text).toBe('See page 4')
  })

  it('finds markers nested inside other blocks', () => {
    const nested: ProseMirrorNodeJson = {
      type: 'doc',
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
                    {
                      type: 'paragraph',
                      content: [{ type: 'footnote', attrs: { footnoteId: 5, text: 'In a cell' } }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    }
    expect(collectFootnotes(nested).map((note) => note.id)).toEqual([5])
  })

  it('returns nothing for a document with no footnotes', () => {
    expect(collectFootnotes({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual([])
  })
})

describe('writeFootnotes', () => {
  it('does nothing for a document that never had footnotes', async () => {
    const pkg = await fixture()
    writeFootnotes(pkg, new Map(), { type: 'doc', content: [{ type: 'paragraph' }] })

    expect(pkg.parts.has(FOOTNOTES_PART)).toBe(false)
  })

  it('creates the part, relationship and content type together', async () => {
    const pkg = await fixture()
    writeFootnotes(pkg, new Map(), docWith([{ id: 1, text: 'A note' }]))

    expect(pkg.parts.has(FOOTNOTES_PART)).toBe(true)
    expect(getPartText(pkg, CONTENT_TYPES_PART)).toContain('/word/footnotes.xml')

    const relationships = parseRelationships(getPartText(pkg, DOCUMENT_RELS_PART) ?? '')
    expect([...relationships.values()].some((entry) => entry.target === 'footnotes.xml')).toBe(true)
  })

  it('writes the separator entries when the source had none', async () => {
    const pkg = await fixture()
    writeFootnotes(pkg, new Map(), docWith([{ id: 1, text: 'A note' }]))

    const written = parseFootnotes(getPartText(pkg, FOOTNOTES_PART) ?? '')
    expect(written.get(-1)?.type).toBe('separator')
    expect(written.get(0)?.type).toBe('continuationSeparator')
  })

  it('writes the note text', async () => {
    const pkg = await fixture()
    writeFootnotes(pkg, new Map(), docWith([{ id: 1, text: 'Source: page 4' }]))

    expect(getPartText(pkg, FOOTNOTES_PART)).toContain('Source: page 4')
  })

  it('drops a note the document no longer references', async () => {
    const pkg = await fixture()
    const existing = new Map(separatorFootnotes())
    existing.set(1, { id: 1, type: null, paragraphs: [] })
    existing.set(2, { id: 2, type: null, paragraphs: [] })

    writeFootnotes(pkg, existing, docWith([{ id: 1, text: 'Kept' }]))

    const written = parseFootnotes(getPartText(pkg, FOOTNOTES_PART) ?? '')
    expect(written.has(2)).toBe(false)
    expect(written.has(1)).toBe(true)
  })

  it('does not rewrite a note whose text is unchanged', async () => {
    const pkg = await fixture()
    writeFootnotes(pkg, new Map(), docWith([{ id: 1, text: 'Stable' }]))
    const first = getPartText(pkg, FOOTNOTES_PART)

    const existing = parseFootnotes(first ?? '')
    writeFootnotes(pkg, existing, docWith([{ id: 1, text: 'Stable' }]))

    expect(getPartText(pkg, FOOTNOTES_PART)).toBe(first)
  })

  it('rewrites a note whose text changed', async () => {
    const pkg = await fixture()
    writeFootnotes(pkg, new Map(), docWith([{ id: 1, text: 'Before' }]))
    const existing = parseFootnotes(getPartText(pkg, FOOTNOTES_PART) ?? '')

    writeFootnotes(pkg, existing, docWith([{ id: 1, text: 'After' }]))

    const written = getPartText(pkg, FOOTNOTES_PART) ?? ''
    expect(written).toContain('After')
    expect(written).not.toContain('Before')
  })

  it('does not add a second relationship on a repeat save', async () => {
    const pkg = await fixture()
    writeFootnotes(pkg, new Map(), docWith([{ id: 1, text: 'x' }]))
    writeFootnotes(pkg, new Map(), docWith([{ id: 1, text: 'x' }]))

    const relationships = parseRelationships(getPartText(pkg, DOCUMENT_RELS_PART) ?? '')
    const pointing = [...relationships.values()].filter((entry) => entry.target === 'footnotes.xml')
    expect(pointing).toHaveLength(1)
  })
})
