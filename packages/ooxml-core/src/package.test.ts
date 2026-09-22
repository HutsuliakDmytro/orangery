import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import {
  CONTENT_TYPES_PART,
  getPartText,
  isTextPart,
  OoxmlFormatError,
  readPackage,
  relsPartFor,
  setPartText,
  writePackage,
} from './package'
import type { OoxmlPackage } from './package'

/**
 * Built here rather than read from a corpus: this package knows nothing about
 * which format it is holding, so testing it against a `.docx` would be testing
 * Word's output for properties that belong to the zip.
 *
 * The apps own the fidelity corpora — Docs round-trips 16 real documents byte
 * for byte, and that is where a regression in a real file shows up.
 */
async function build(entries: [path: string, content: string | Uint8Array][]): Promise<Uint8Array> {
  const zip = new JSZip()
  for (const [path, content] of entries) zip.file(path, content)
  return zip.generateAsync({ type: 'uint8array' })
}

const PICTURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff])

const sample = () =>
  build([
    [CONTENT_TYPES_PART, '<Types/>'],
    ['word/document.xml', '<w:document>hello</w:document>'],
    ['word/_rels/document.xml.rels', '<Relationships/>'],
    ['word/media/image1.png', PICTURE],
  ])

describe('isTextPart', () => {
  it('treats xml and rels as text', () => {
    expect(isTextPart('word/document.xml')).toBe(true)
    expect(isTextPart('word/_rels/document.xml.rels')).toBe(true)
    expect(isTextPart('ppt/slides/slide1.xml')).toBe(true)
  })

  it('treats media as binary', () => {
    expect(isTextPart('word/media/image1.png')).toBe(false)
    expect(isTextPart('ppt/media/video1.mp4')).toBe(false)
  })
})

describe('readPackage', () => {
  it('reads every entry as a part', async () => {
    const pkg = await readPackage(await sample())

    expect([...pkg.parts.keys()]).toEqual([
      CONTENT_TYPES_PART,
      'word/document.xml',
      'word/_rels/document.xml.rels',
      'word/media/image1.png',
    ])
  })

  it('decodes xml parts to text and keeps bytes for all', async () => {
    const pkg = await readPackage(await sample())

    expect(pkg.parts.get('word/document.xml')?.text).toBe('<w:document>hello</w:document>')
    expect(pkg.parts.get('word/media/image1.png')?.text).toBeUndefined()
    expect(pkg.parts.get('word/media/image1.png')?.bytes).toStrictEqual(PICTURE)
  })

  it('accepts any zip when no part is required', async () => {
    const pkg = await readPackage(await build([['hello.txt', 'not a document']]))
    expect(pkg.parts.has('hello.txt')).toBe(true)
  })

  it('rejects a package missing the part the app asked for', async () => {
    const zip = await build([['hello.txt', 'not a document']])

    await expect(readPackage(zip, 'word/document.xml')).rejects.toBeInstanceOf(OoxmlFormatError)
  })

  it('names the missing part, so the message says what was opened', async () => {
    const zip = await build([['word/document.xml', '<w:document/>']])

    await expect(readPackage(zip, 'ppt/presentation.xml')).rejects.toThrow('ppt/presentation.xml')
  })
})

describe('writePackage', () => {
  it('round-trips every part unchanged when nothing is edited', async () => {
    const original = await readPackage(await sample())
    const rewritten = await readPackage(await writePackage(original))

    for (const [path, part] of original.parts) {
      expect(rewritten.parts.get(path)?.bytes).toStrictEqual(part.bytes)
    }
  })

  it('applies an edit to one part and leaves the rest byte-identical', async () => {
    const pkg = await readPackage(await sample())
    const before = getPartText(pkg, 'word/document.xml') ?? ''

    setPartText(pkg, 'word/document.xml', before.replace('hello', 'edited'))
    const rewritten = await readPackage(await writePackage(pkg))

    expect(getPartText(rewritten, 'word/document.xml')).toContain('edited')
    expect(rewritten.parts.get('word/media/image1.png')?.bytes).toStrictEqual(PICTURE)
  })

  it('preserves part order, which Word is sensitive to', async () => {
    const original = await readPackage(await sample())
    const rewritten = await readPackage(await writePackage(original))

    expect([...rewritten.parts.keys()]).toEqual([...original.parts.keys()])
  })

  it('keeps the entry date, so saving does not churn timestamps', async () => {
    const pkg = await readPackage(await sample())
    const date = pkg.parts.get('word/document.xml')?.date

    setPartText(pkg, 'word/document.xml', '<w:document/>')
    expect(pkg.parts.get('word/document.xml')?.date).toStrictEqual(date)
  })
})

describe('storing a part uncompressed', () => {
  it('keeps its bytes readable where a deflated one would not be', async () => {
    const pkg: OoxmlPackage = { parts: new Map() }
    const text = 'application/vnd.oasis.opendocument.presentation'
    pkg.parts.set('mimetype', {
      path: 'mimetype',
      bytes: new TextEncoder().encode(text),
      date: new Date(),
    })

    const zipped = await writePackage(pkg, { stored: ['mimetype'] })

    // The whole point of storing it: the contents appear in the archive as
    // themselves, which is what lets a reader identify the file without
    // unzipping it.
    expect(new TextDecoder().decode(zipped)).toContain(text)
  })

  it('deflates it when not asked, which is what OOXML wants', async () => {
    const pkg: OoxmlPackage = { parts: new Map() }
    const text = 'application/vnd.oasis.opendocument.presentation'
    pkg.parts.set('mimetype', {
      path: 'mimetype',
      bytes: new TextEncoder().encode(text),
      date: new Date(),
    })

    const zipped = await writePackage(pkg)
    expect(new TextDecoder().decode(zipped)).not.toContain(text)
  })

  it('reads back the same either way', async () => {
    const pkg: OoxmlPackage = { parts: new Map() }
    pkg.parts.set('mimetype', {
      path: 'mimetype',
      bytes: new TextEncoder().encode('x'),
      date: new Date(),
    })

    const stored = await readPackage(await writePackage(pkg, { stored: ['mimetype'] }))
    const deflated = await readPackage(await writePackage(pkg))

    expect(stored.parts.get('mimetype')?.bytes).toEqual(deflated.parts.get('mimetype')?.bytes)
  })
})

/**
 * Packages Word and Excel open, and the ones they do not.
 *
 * Every case here is a file out of the corpus that took the reader down or was
 * refused with a sentence nobody could act on. The rule the fixes share: a
 * package either opens or says something true about why it did not.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/9
 */
describe('a package written by something unusual', () => {
  it('reads entries whose names use the separator Windows prefers', async () => {
    // LibreOffice's tdf76115.xlsx and POI's 49609.xlsx are both like this, and
    // Excel opens both.
    const zip = new JSZip()
    zip.file(CONTENT_TYPES_PART, '<Types/>')
    zip.file('xl\\workbook.xml', '<workbook/>')
    zip.file('xl\\worksheets\\sheet1.xml', '<worksheet/>')

    const pkg = await readPackage(
      await zip.generateAsync({ type: 'uint8array' }),
      'xl/workbook.xml',
    )

    expect([...pkg.parts.keys()]).toEqual([
      CONTENT_TYPES_PART,
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ])
    expect(getPartText(pkg, 'xl/worksheets/sheet1.xml')).toBe('<worksheet/>')
  })

  it('says so when the main part is somewhere else', async () => {
    const data = await build([
      [CONTENT_TYPES_PART, '<Types/>'],
      [
        '_rels/.rels',
        '<Relationships><Relationship Id="rId1" Target="word/trial.xml" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/></Relationships>',
      ],
      ['word/trial.xml', '<w:document/>'],
    ])

    await expect(readPackage(data, 'word/document.xml')).rejects.toThrow(
      /main part at word\/trial\.xml/u,
    )
  })

  it('names the format when the file is an OpenDocument one', async () => {
    const data = await build([
      ['mimetype', 'application/vnd.oasis.opendocument.text'],
      ['content.xml', '<office:document-content/>'],
    ])

    await expect(readPackage(data, 'word/document.xml')).rejects.toThrow(
      /OpenDocument text \(\.odt\)/u,
    )
  })

  it('still says what is missing when nothing explains it', async () => {
    const data = await build([[CONTENT_TYPES_PART, '<Types/>']])

    await expect(readPackage(data, 'word/document.xml')).rejects.toThrow(
      /word\/document\.xml is missing/u,
    )
  })

  it('answers a file that is not a zip with a sentence, not a zip library error', async () => {
    const promise = readPackage(new TextEncoder().encode('this is not a zip at all'))

    await expect(promise).rejects.toBeInstanceOf(OoxmlFormatError)
    await expect(promise).rejects.toThrow(/not a readable zip/u)
  })
})

/**
 * The main part, found the way the format says to find it.
 *
 * `word/document.xml` is a convention. What makes a part the main one is
 * `_rels/.rels` pointing its `officeDocument` relationship at it, and
 * LibreOffice's `tdf104713_undefinedStyles.docx` — which Word opens — calls it
 * `word/trial.xml`.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/9
 */
describe('which part a package is about', () => {
  const WORD_MAIN = [
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
  ]

  const rels = (target: string) =>
    `<Relationships><Relationship Id="rId1" Target="${target}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument"/></Relationships>`

  const types = (part: string, contentType = WORD_MAIN[0] ?? '') =>
    `<Types><Override PartName="${part}" ContentType="${contentType}"/></Types>`

  it('follows the relationship rather than the convention', async () => {
    const data = await build([
      [CONTENT_TYPES_PART, types('/word/trial.xml')],
      ['_rels/.rels', rels('word/trial.xml')],
      ['word/trial.xml', '<w:document/>'],
    ])

    const pkg = await readPackage(data, {
      conventional: 'word/document.xml',
      contentType: WORD_MAIN,
    })

    expect(pkg.main).toBe('word/trial.xml')
  })

  it('takes an absolute target the same way', async () => {
    const data = await build([
      [CONTENT_TYPES_PART, types('/word/trial.xml')],
      ['_rels/.rels', rels('/word/trial.xml')],
      ['word/trial.xml', '<w:document/>'],
    ])

    expect((await readPackage(data)).main).toBe('word/trial.xml')
  })

  it('falls back to the conventional name when nothing names a main part', async () => {
    const data = await build([
      [CONTENT_TYPES_PART, types('/word/document.xml')],
      ['word/document.xml', '<w:document/>'],
    ])

    const pkg = await readPackage(data, {
      conventional: 'word/document.xml',
      contentType: WORD_MAIN,
    })

    expect(pkg.main).toBe('word/document.xml')
  })

  it('refuses a package whose main part is another format', async () => {
    const data = await build([
      [
        CONTENT_TYPES_PART,
        types(
          '/ppt/presentation.xml',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml',
        ),
      ],
      ['_rels/.rels', rels('ppt/presentation.xml')],
      ['ppt/presentation.xml', '<p:presentation/>'],
    ])

    await expect(
      readPackage(data, { conventional: 'word/document.xml', contentType: WORD_MAIN }),
    ).rejects.toThrow(/which calls itself .*presentationml.*word\/document\.xml/u)
  })

  it('takes a package whose content types say nothing about the main part', async () => {
    // Unusual, and not grounds for refusing a file whose relationship already
    // said what it is.
    const data = await build([
      [CONTENT_TYPES_PART, '<Types/>'],
      ['_rels/.rels', rels('word/trial.xml')],
      ['word/trial.xml', '<w:document/>'],
    ])

    const pkg = await readPackage(data, {
      conventional: 'word/document.xml',
      contentType: WORD_MAIN,
    })

    expect(pkg.main).toBe('word/trial.xml')
  })
})

describe('relsPartFor', () => {
  it('puts the rels beside the part it belongs to', () => {
    expect(relsPartFor('word/trial.xml')).toBe('word/_rels/trial.xml.rels')
    expect(relsPartFor('xl/workbook.xml')).toBe('xl/_rels/workbook.xml.rels')
    expect(relsPartFor('ppt/slides/slide1.xml')).toBe('ppt/slides/_rels/slide1.xml.rels')
  })

  it('takes a part at the root of the package', () => {
    expect(relsPartFor('document.xml')).toBe('_rels/document.xml.rels')
  })
})
