import { compareXml, describeDifferences, getPartText } from '@orangery/ooxml-core'
import { CONVENTIONAL_DOCUMENT_PART, readDocxPackage } from '../ooxml/parts'
import JSZip from 'jszip'
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
    const before = getPartText(document.pkg, CONVENTIONAL_DOCUMENT_PART) ?? ''

    const saved = await saveDocx(document, document.doc)
    const after = getPartText(await readDocxPackage(saved), CONVENTIONAL_DOCUMENT_PART) ?? ''

    expect(describeDifferences(compareXml(before, after))).toBe('no differences')
  })

  it('leaves every other part byte-identical', async () => {
    const document = await open('lists')
    const original = new Map(
      [...document.pkg.parts].map(([path, part]) => [path, new Uint8Array(part.bytes)]),
    )

    const saved = await readDocxPackage(await saveDocx(document, document.doc))

    for (const [path, bytes] of original) {
      if (path === CONVENTIONAL_DOCUMENT_PART) continue
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

    expect(document.pkg.parts.has(CONVENTIONAL_DOCUMENT_PART)).toBe(true)
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
    const before = getPartText(document.pkg, CONVENTIONAL_DOCUMENT_PART) ?? ''
    const after =
      getPartText(
        await readDocxPackage(await saveDocx(document, document.doc)),
        CONVENTIONAL_DOCUMENT_PART,
      ) ?? ''

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

/**
 * A document whose main part is not called `word/document.xml`.
 *
 * The name is a convention: what makes a part the document is `_rels/.rels`
 * pointing its `officeDocument` relationship at it. LibreOffice's
 * `sw/qa/extras/ooxmlexport/data/tdf104713_undefinedStyles.docx` calls it
 * `word/trial.xml`, Word opens it, and until this it was refused here with
 * "word/document.xml is missing". The file itself is MPL-2.0 and cannot live
 * in the repository, so the package here is the same shape built by hand.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/9
 */
describe('a document part called something else', () => {
  const WORD = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

  const trial = async (): Promise<Uint8Array> => {
    const zip = new JSZip()
    zip.file(
      '[Content_Types].xml',
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/trial.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
        '</Types>',
    )
    zip.file(
      '_rels/.rels',
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Target="word/trial.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/>' +
        '</Relationships>',
    )
    zip.file(
      'word/trial.xml',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<w:document xmlns:w="${WORD}"><w:body><w:p><w:r><w:t>Trial</w:t></w:r></w:p></w:body></w:document>`,
    )

    return zip.generateAsync({ type: 'uint8array' })
  }

  it('opens, and reads the text out of the part the relationship names', async () => {
    const open = await openDocx(await trial())

    expect(open.pkg.main).toBe('word/trial.xml')
    expect(JSON.stringify(open.doc)).toContain('Trial')
  })

  it('saves back into that part, and does not invent the conventional one', async () => {
    const open = await openDocx(await trial())
    const saved = await readDocxPackage(await saveDocx(open, open.doc))

    expect(getPartText(saved, 'word/trial.xml')).toContain('Trial')
    expect(saved.parts.has(CONVENTIONAL_DOCUMENT_PART)).toBe(false)
  })

  it('reopens to the same document', async () => {
    const open = await openDocx(await trial())
    const again = await openDocx(await saveDocx(open, open.doc))

    expect(again.doc).toEqual(open.doc)
  })
})
