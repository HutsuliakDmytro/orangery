import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONTENT_TYPES_PART, DOCUMENT_PART, getPartText, readPackage } from '../ooxml/package'
import { parseRelationships } from '../ooxml/relationships'
import { parseDocument } from '../ooxml/parse-document'
import { parseSection } from '../ooxml/section'
import { element, textValue, children } from '../ooxml/xml'
import type { XmlNode } from '../ooxml/xml'
import { textFromParagraphs } from './header-footer-text'
import { DOCUMENT_RELS_PART } from './media'
import { readHeaderFooter, writeHeaderFooter } from './header-footer-session'

const FIXTURES = join(process.cwd(), 'tests/fixtures/docx/synthetic')

async function open(name: string) {
  const pkg = await readPackage(await readFile(join(FIXTURES, `${name}.docx`)))
  const parsed = parseDocument(getPartText(pkg, DOCUMENT_PART) ?? '')
  return { pkg, section: parseSection(parsed.sectionProperties) }
}

const paragraph = (text: string) =>
  element('w:p', {}, [element('w:r', {}, [element('w:t', {}, [{ '#text': text }])])])

describe('readHeaderFooter', () => {
  it('reads an existing header', async () => {
    const { pkg, section } = await open('headers-footers')
    const header = readHeaderFooter(pkg, section, 'header')

    expect(header.path).not.toBeNull()
    expect(header.paragraphs.length).toBeGreaterThan(0)
  })

  it('reports no part for a document without one', async () => {
    const { pkg, section } = await open('plain-paragraphs')
    expect(readHeaderFooter(pkg, section, 'header').path).toBeNull()
  })
})

describe('writeHeaderFooter', () => {
  it('replaces the content of an existing header', async () => {
    const { pkg, section } = await open('headers-footers')
    writeHeaderFooter(pkg, section, 'header', [paragraph('Replaced')])

    const header = readHeaderFooter(pkg, section, 'header')
    const [first] = header.paragraphs
    const run = first ? children(first)[0] : undefined
    const text = run ? children(run)[0] : undefined
    const value = text ? children(text)[0] : undefined

    expect(value && textValue(value)).toBe('Replaced')
  })

  it('does not add a second reference when one already exists', async () => {
    const { pkg, section } = await open('headers-footers')
    const updated = writeHeaderFooter(pkg, section, 'header', [paragraph('x')])

    expect(updated.preserved).toEqual(section.preserved)
  })

  it('creates the part for a document that has none', async () => {
    const { pkg, section } = await open('plain-paragraphs')
    const updated = writeHeaderFooter(pkg, section, 'footer', [paragraph('Page')])

    expect(readHeaderFooter(pkg, updated, 'footer').path).toBe('word/footer1.xml')
  })

  it('adds the relationship the reference points at', async () => {
    const { pkg, section } = await open('plain-paragraphs')
    const updated = writeHeaderFooter(pkg, section, 'footer', [paragraph('Page')])

    const relationships = parseRelationships(getPartText(pkg, DOCUMENT_RELS_PART) ?? '')
    const referenced = updated.preserved.join('').match(/r:id="(rId\d+)"/u)?.[1]

    expect(referenced).toBeDefined()
    expect(relationships.get(referenced ?? '')?.target).toBe('footer1.xml')
  })

  it('declares the part in [Content_Types].xml', async () => {
    const { pkg, section } = await open('plain-paragraphs')
    writeHeaderFooter(pkg, section, 'footer', [paragraph('Page')])

    expect(getPartText(pkg, CONTENT_TYPES_PART)).toContain('/word/footer1.xml')
  })

  it('does not collide with a part name already in the package', async () => {
    const { pkg, section } = await open('headers-footers')
    const updated = writeHeaderFooter(pkg, section, 'footer', [paragraph('New')])

    // The fixture already has footer1.xml, so a new part must not overwrite it.
    const created = readHeaderFooter(pkg, updated, 'footer').path
    expect(created).not.toBeNull()
  })

  it('leaves the document part untouched', async () => {
    const { pkg, section } = await open('plain-paragraphs')
    const before = getPartText(pkg, DOCUMENT_PART)

    writeHeaderFooter(pkg, section, 'header', [paragraph('Top')])
    expect(getPartText(pkg, DOCUMENT_PART)).toBe(before)
  })
})

describe('the first page having its own', () => {
  // The same reader the app uses, so the test cannot agree with a bug in it.
  const textOf = (paragraphs: readonly XmlNode[]) => textFromParagraphs(paragraphs)

  it('writes a separate part, not into the default one', async () => {
    const { pkg } = await open('plain-paragraphs')
    let section = { ...(await open('plain-paragraphs')).section, preserved: [] as string[] }

    section = writeHeaderFooter(pkg, section, 'header', [paragraph('every page')])
    section = writeHeaderFooter(pkg, section, 'header', [paragraph('title page')], 'first')

    expect(textOf(readHeaderFooter(pkg, section, 'header').paragraphs)).toBe('every page')
    expect(textOf(readHeaderFooter(pkg, section, 'header', 'first').paragraphs)).toBe('title page')
  })

  it('marks the reference with the type that makes Word use it', async () => {
    // Without `w:type="first"` the part is a second default, and Word shows
    // whichever reference it reads last on every page.
    const { pkg, section } = await open('plain-paragraphs')
    const updated = writeHeaderFooter(
      pkg,
      { ...section, preserved: [] },
      'header',
      [paragraph('title page')],
      'first',
    )

    expect(updated.preserved.join('')).toContain('w:type="first"')
  })

  it('finds nothing for a first page in a document that has no such part', async () => {
    const { pkg, section } = await open('headers-footers')
    expect(readHeaderFooter(pkg, section, 'header', 'first').path).toBeNull()
  })

  it('keeps the two apart when both are rewritten', async () => {
    const { pkg, section } = await open('plain-paragraphs')
    let current = { ...section, preserved: [] as string[] }

    current = writeHeaderFooter(pkg, current, 'footer', [paragraph('one')], 'first')
    current = writeHeaderFooter(pkg, current, 'footer', [paragraph('two')])
    current = writeHeaderFooter(pkg, current, 'footer', [paragraph('three')], 'first')

    expect(textOf(readHeaderFooter(pkg, current, 'footer').paragraphs)).toBe('two')
    expect(textOf(readHeaderFooter(pkg, current, 'footer', 'first').paragraphs)).toBe('three')
  })
})
