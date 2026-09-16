import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CONTENT_TYPES_PART,
  DOCUMENT_PART,
  DocxFormatError,
  getPartText,
  isTextPart,
  mediaParts,
  readPackage,
  setPartText,
  STYLES_PART,
  writePackage,
} from './package'

const FIXTURES = join(process.cwd(), 'tests/fixtures/docx/synthetic')

function fixture(name: string): Promise<Buffer> {
  return readFile(join(FIXTURES, `${name}.docx`))
}

describe('isTextPart', () => {
  it('treats xml and rels as text', () => {
    expect(isTextPart('word/document.xml')).toBe(true)
    expect(isTextPart('word/_rels/document.xml.rels')).toBe(true)
  })

  it('treats media as binary', () => {
    expect(isTextPart('word/media/image1.png')).toBe(false)
  })
})

describe('readPackage', () => {
  it('reads every part of a real package', async () => {
    const pkg = await readPackage(await fixture('headings'))

    expect(pkg.parts.has(DOCUMENT_PART)).toBe(true)
    expect(pkg.parts.has(CONTENT_TYPES_PART)).toBe(true)
    expect(pkg.parts.has(STYLES_PART)).toBe(true)
  })

  it('decodes xml parts to text and keeps bytes for all', async () => {
    const pkg = await readPackage(await fixture('headings'))
    const document = pkg.parts.get(DOCUMENT_PART)

    expect(document?.text).toContain('<w:document')
    expect(document?.bytes.byteLength).toBeGreaterThan(0)
  })

  it('rejects a zip that is not a DOCX', async () => {
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    zip.file('hello.txt', 'not a document')
    const bytes = await zip.generateAsync({ type: 'uint8array' })

    await expect(readPackage(bytes)).rejects.toBeInstanceOf(DocxFormatError)
  })
})

describe('writePackage', () => {
  it('round-trips every part unchanged when nothing is edited', async () => {
    const original = await readPackage(await fixture('tables'))
    const rewritten = await readPackage(await writePackage(original))

    expect([...rewritten.parts.keys()].sort()).toEqual([...original.parts.keys()].sort())

    for (const [path, part] of original.parts) {
      const after = rewritten.parts.get(path)
      expect(after?.bytes).toStrictEqual(part.bytes)
    }
  })

  it('applies an edit to one part and leaves the rest byte-identical', async () => {
    const pkg = await readPackage(await fixture('plain-paragraphs'))
    const before = getPartText(pkg, DOCUMENT_PART) ?? ''

    setPartText(pkg, DOCUMENT_PART, before.replace('Paragraph 1', 'Edited'))
    const rewritten = await readPackage(await writePackage(pkg))

    expect(getPartText(rewritten, DOCUMENT_PART)).toContain('Edited')
    expect(rewritten.parts.get(STYLES_PART)?.bytes).toStrictEqual(pkg.parts.get(STYLES_PART)?.bytes)
  })

  it('preserves part order, which Word is sensitive to', async () => {
    const original = await readPackage(await fixture('lists'))
    const rewritten = await readPackage(await writePackage(original))

    expect([...rewritten.parts.keys()]).toEqual([...original.parts.keys()])
  })
})

describe('mediaParts', () => {
  it('returns nothing for a document without media', async () => {
    const pkg = await readPackage(await fixture('plain-paragraphs'))
    expect(mediaParts(pkg)).toEqual([])
  })
})
