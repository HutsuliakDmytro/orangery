import { describe, expect, it } from 'vitest'
import { NUMBERING_PART, CONTENT_TYPES_PART, getPartText, readPackage } from '../ooxml/package'
import { parseNumbering, resolveNumbering } from '../ooxml/numbering'
import { parseRelationships } from '../ooxml/relationships'
import type { ProseMirrorNodeJson } from '../ooxml/prosemirror-json'
import { createNewDocx, openDocx, saveDocx } from './docx-file'
import { DOCUMENT_RELS_PART } from './media'

/**
 * A list created in a new document has to bring its numbering definition with
 * it. Without one, Word opens the file and renders the list as body text.
 */

const listDoc: ProseMirrorNodeJson = {
  type: 'doc',
  content: [
    {
      type: 'bulletList',
      content: [
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }] }],
        },
        {
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'two' }] }],
        },
      ],
    },
  ],
}

describe('saving a document with a new list', () => {
  it('keeps the text', async () => {
    const document = await createNewDocx()
    const reopened = await openDocx(await saveDocx(document, listDoc))

    expect(JSON.stringify(reopened.doc)).toContain('one')
    expect(JSON.stringify(reopened.doc)).toContain('two')
  })

  it('creates the numbering part', async () => {
    const document = await createNewDocx()
    const pkg = await readPackage(await saveDocx(document, listDoc))

    expect(pkg.parts.has(NUMBERING_PART)).toBe(true)
  })

  it('defines the numbering the paragraphs point at', async () => {
    const document = await createNewDocx()
    const saved = await readPackage(await saveDocx(document, listDoc))

    const numbering = parseNumbering(getPartText(saved, NUMBERING_PART) ?? '')
    const referenced = (getPartText(saved, 'word/document.xml') ?? '').match(
      /<w:numId w:val="(\d+)"\/>/u,
    )?.[1]

    expect(referenced).toBeDefined()
    expect(resolveNumbering(numbering, Number(referenced), 0)).not.toBeNull()
  })

  it('defines a bullet glyph for the first level', async () => {
    const document = await createNewDocx()
    const saved = await readPackage(await saveDocx(document, listDoc))
    const numbering = parseNumbering(getPartText(saved, NUMBERING_PART) ?? '')

    const level = resolveNumbering(numbering, 1, 0)
    expect(level?.format).toBe('bullet')
    expect(level?.text).not.toBe('')
  })

  it('adds the relationship and content type the part needs', async () => {
    const document = await createNewDocx()
    const saved = await readPackage(await saveDocx(document, listDoc))

    const relationships = parseRelationships(getPartText(saved, DOCUMENT_RELS_PART) ?? '')
    expect([...relationships.values()].some((entry) => entry.target === 'numbering.xml')).toBe(true)
    expect(getPartText(saved, CONTENT_TYPES_PART)).toContain('/word/numbering.xml')
  })

  it('reopens the list as a list', async () => {
    // OOXML has no list element — a list is a run of paragraphs sharing a
    // numbering definition — so this is where they are put back together.
    const document = await createNewDocx()
    const reopened = await openDocx(await saveDocx(document, listDoc))

    const first = reopened.doc.content?.[0]
    expect(first?.type).toBe('bulletList')
    expect(first?.content?.[0]?.content?.[0]?.attrs?.['numbering']).toMatchObject({ level: 0 })
  })

  it('does not add a second definition for a list it read from the file', async () => {
    const document = await createNewDocx()
    const once = await openDocx(await saveDocx(document, listDoc))
    const twice = await readPackage(await saveDocx(once, once.doc))

    const numbering = getPartText(twice, NUMBERING_PART) ?? ''
    expect(numbering.match(/<w:num /gu)).toHaveLength(1)
  })

  it('does not add a numbering part to a document with no lists', async () => {
    const document = await createNewDocx()
    const saved = await readPackage(await saveDocx(document, document.doc))

    expect(saved.parts.has(NUMBERING_PART)).toBe(false)
  })

  it('does not add a second relationship when saving twice', async () => {
    const document = await createNewDocx()
    await saveDocx(document, listDoc)
    const saved = await readPackage(await saveDocx(document, listDoc))

    const relationships = parseRelationships(getPartText(saved, DOCUMENT_RELS_PART) ?? '')
    const pointing = [...relationships.values()].filter((entry) => entry.target === 'numbering.xml')
    expect(pointing).toHaveLength(1)
  })
})
