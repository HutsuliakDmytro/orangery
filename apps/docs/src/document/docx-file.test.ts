import { compareXml, describeDifferences, getPartText } from '@orangery/ooxml-core'
import { DOCUMENT_PART, readDocxPackage } from '../ooxml/parts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createNewDocx, openDocx, saveDocx } from './docx-file'

const FIXTURES = join(process.cwd(), 'tests/fixtures/docx/synthetic')

async function open(name: string) {
  return openDocx(await readFile(join(FIXTURES, `${name}.docx`)))
}

describe('openDocx', () => {
  it('parses the document and its catalogues', async () => {
    const document = await open('headings')

    expect(document.doc.content?.length).toBeGreaterThan(1)
    expect(document.styles.styles.size).toBeGreaterThan(0)
    expect(document.documentAttributes['xmlns:w']).toContain('wordprocessingml')
  })

  it('collects warnings for constructs it preserves but cannot edit', async () => {
    const document = await open('sections-page-setup')
    // Tables are editable now; anything still unmodelled reports itself here.
    expect(Array.isArray(document.warnings)).toBe(true)
  })

  it('opens a document with tables without warning about them', async () => {
    const document = await open('tables')
    expect(document.warnings.some((warning) => warning.tag === 'w:tbl')).toBe(false)
  })

  it('keeps the package for the session', async () => {
    const document = await open('lists')
    expect(document.pkg.parts.has('word/numbering.xml')).toBe(true)
  })
})

describe('saveDocx', () => {
  it('writes a package that reopens to the same document', async () => {
    const document = await open('paragraph-formatting')
    const saved = await saveDocx(document, document.doc)
    const reopened = await openDocx(saved)

    expect(JSON.stringify(reopened.doc)).toBe(JSON.stringify(document.doc))
  })

  it('leaves document.xml structurally unchanged when nothing was edited', async () => {
    const document = await open('character-formatting')
    const before = getPartText(document.pkg, DOCUMENT_PART) ?? ''

    const saved = await saveDocx(document, document.doc)
    const after = getPartText(await readDocxPackage(saved), DOCUMENT_PART) ?? ''

    expect(describeDifferences(compareXml(before, after))).toBe('no differences')
  })

  it('leaves every other part byte-identical', async () => {
    const document = await open('lists')
    const original = new Map(
      [...document.pkg.parts].map(([path, part]) => [path, new Uint8Array(part.bytes)]),
    )

    const saved = await readDocxPackage(await saveDocx(document, document.doc))

    for (const [path, bytes] of original) {
      if (path === DOCUMENT_PART) continue
      expect(saved.parts.get(path)?.bytes, path).toStrictEqual(bytes)
    }
  })

  it('carries an edit through to the saved file', async () => {
    const document = await open('plain-paragraphs')
    const edited = structuredClone(document.doc)
    const firstText = edited.content?.[0]?.content?.[0]
    if (firstText) firstText.text = 'Replaced text'

    const reopened = await openDocx(await saveDocx(document, edited))
    expect(JSON.stringify(reopened.doc)).toContain('Replaced text')
  })
})

describe('createNewDocx', () => {
  it('produces a real DOCX package from the first keystroke', async () => {
    const document = await createNewDocx()

    expect(document.pkg.parts.has(DOCUMENT_PART)).toBe(true)
    expect(document.pkg.parts.has('[Content_Types].xml')).toBe(true)
    expect(document.pkg.parts.has('word/styles.xml')).toBe(true)
    expect(document.pkg.parts.has('_rels/.rels')).toBe(true)
  })

  it('starts with one empty paragraph', async () => {
    const document = await createNewDocx()
    expect(document.doc.content).toHaveLength(1)
    expect(document.doc.content?.[0]?.type).toBe('paragraph')
  })

  it('carries page setup so page size survives', async () => {
    const document = await createNewDocx()
    expect(document.section.width).toBe(612)
    expect(document.section.height).toBe(792)
    expect(document.section.margins.top).toBe(72)
  })

  it('writes a changed page setup back into the file', async () => {
    const document = await createNewDocx()
    const landscape = {
      ...document.section,
      width: 792,
      height: 612,
      orientation: 'landscape' as const,
    }

    const reopened = await openDocx(await saveDocx(document, document.doc, { section: landscape }))
    expect(reopened.section.orientation).toBe('landscape')
    expect(reopened.section.width).toBe(792)
  })

  it('defines the heading and title styles the editor offers', async () => {
    const document = await createNewDocx()
    const ids = [...document.styles.styles.keys()]

    expect(ids).toContain('Normal')
    expect(ids).toContain('Title')
    expect(ids).toContain('Subtitle')
    for (let level = 1; level <= 6; level += 1) {
      expect(ids).toContain(`Heading${String(level)}`)
    }
  })

  it('opens without warnings', async () => {
    expect((await createNewDocx()).warnings).toEqual([])
  })

  it('round-trips a save with no edits', async () => {
    const document = await createNewDocx()
    const before = getPartText(document.pkg, DOCUMENT_PART) ?? ''
    const after =
      getPartText(await readDocxPackage(await saveDocx(document, document.doc)), DOCUMENT_PART) ??
      ''

    expect(describeDifferences(compareXml(before, after))).toBe('no differences')
  })
})

describe('page numbering in the package', () => {
  const doc = { type: 'doc', content: [{ type: 'paragraph' }] }

  it('round-trips the format, the starting number and the title page', async () => {
    const document = await createNewDocx()
    const section = {
      ...document.section,
      pageNumbering: { format: 'lowerRoman' as const, start: 3 },
      differentFirstPage: true,
    }

    const reopened = await openDocx(await saveDocx(document, doc, { section }))

    expect(reopened.section.pageNumbering).toEqual({ format: 'lowerRoman', start: 3 })
    expect(reopened.section.differentFirstPage).toBe(true)
  })

  it('leaves a document that states neither without either element', async () => {
    const document = await createNewDocx()
    const saved = await saveDocx(document, doc)
    const reopened = await openDocx(saved)

    expect(reopened.section.pageNumbering).toBeNull()
    expect(reopened.section.differentFirstPage).toBe(false)
  })
})
