import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readPackage, writePackage } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { textOfBody, EMU_PER_INCH } from '@orangery/ooxml-drawingml'
import { flatten, readDeck, readPptxPackage } from '@orangery/ooxml-presentation'
import { NotAnOdpError, readOdp } from './odp-read'
import { deckFromOdp } from './odp-import'
import { writeOdp } from './odp-write'

/**
 * OpenDocument Presentation, in and out.
 *
 * The fixtures are built here rather than checked in as binaries: an ODP is a
 * zip of XML, and a test that shows the XML it is reading says what it is
 * testing. What it cannot show — that Impress agrees — is what the corpus and a
 * pair of human eyes are for.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0"',
  'xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
].join(' ')

/** Zips the given files into an `.odp`, through the same writer the app uses. */
async function odp(files: Record<string, string | Uint8Array>): Promise<Uint8Array> {
  const pkg: OoxmlPackage = { parts: new Map() }
  const encoder = new TextEncoder()

  for (const [path, contents] of Object.entries(files)) {
    const bytes = typeof contents === 'string' ? encoder.encode(contents) : contents
    pkg.parts.set(path, {
      path,
      bytes,
      ...(typeof contents === 'string' ? { text: contents } : {}),
      date: new Date(),
    })
  }

  return writePackage(pkg)
}

function content(pages: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${NS} office:version="1.3"><office:body><office:presentation>${pages}</office:presentation></office:body></office:document-content>`
}

const styles = (width: string, height: string) =>
  `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${NS}><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${width}" fo:page-height="${height}"/></style:page-layout></office:automatic-styles></office:document-styles>`

const textFrame = (body: string, at = 'svg:x="1in" svg:y="1in" svg:width="4in" svg:height="2in"') =>
  `<draw:frame draw:layer="layout" ${at}><draw:text-box>${body}</draw:text-box></draw:frame>`

describe('reading an ODP', () => {
  it('refuses something that is not one', async () => {
    const notADeck = await odp({ 'content.xml': '<office:document-content/>' })
    await expect(readOdp(notADeck)).rejects.toBeInstanceOf(NotAnOdpError)
  })

  it('refuses a text document wearing the same envelope', async () => {
    const text = `<?xml version="1.0"?><office:document-content ${NS}><office:body><office:text/></office:body></office:document-content>`
    await expect(readOdp(await odp({ 'content.xml': text }))).rejects.toBeInstanceOf(NotAnOdpError)
  })

  it('reads a page per slide', async () => {
    const file = await odp({
      'content.xml': content('<draw:page draw:name="a"/><draw:page draw:name="b"/>'),
    })

    const deck = await readOdp(file)
    expect(deck.pages.map((page) => page.name)).toEqual(['a', 'b'])
  })

  it('reads the page size out of the styles', async () => {
    const file = await odp({
      'content.xml': content('<draw:page/>'),
      'styles.xml': styles('10in', '7.5in'),
    })

    expect((await readOdp(file)).size).toEqual({
      width: 10 * EMU_PER_INCH,
      height: 7.5 * EMU_PER_INCH,
    })
  })

  it('reads a text frame where the file put it', async () => {
    const file = await odp({
      'content.xml': content(`<draw:page>${textFrame('<text:p>Hello</text:p>')}</draw:page>`),
    })

    const shape = (await readOdp(file)).pages[0]?.shapes[0]
    expect(shape?.kind).toBe('text')
    expect(shape).toMatchObject({
      x: EMU_PER_INCH,
      y: EMU_PER_INCH,
      width: 4 * EMU_PER_INCH,
      height: 2 * EMU_PER_INCH,
    })
  })

  it('turns nested lists back into outline levels', async () => {
    const body =
      '<text:p>Top</text:p><text:list><text:list-item><text:p>One</text:p></text:list-item>' +
      '<text:list-item><text:list><text:list-item><text:p>Two</text:p></text:list-item></text:list></text:list-item></text:list>'
    const file = await odp({ 'content.xml': content(`<draw:page>${textFrame(body)}</draw:page>`) })

    const shape = (await readOdp(file)).pages[0]?.shapes[0]
    expect(shape?.kind === 'text' ? shape.lines : []).toEqual([
      { text: 'Top', level: 0 },
      { text: 'One', level: 0 },
      { text: 'Two', level: 1 },
    ])
  })

  it('keeps the spaces a file spelled out as elements', async () => {
    const body = '<text:p>a<text:s text:c="3"/>b<text:tab/>c</text:p>'
    const file = await odp({ 'content.xml': content(`<draw:page>${textFrame(body)}</draw:page>`) })

    const shape = (await readOdp(file)).pages[0]?.shapes[0]
    expect(shape?.kind === 'text' ? shape.lines[0]?.text : '').toBe('a   b\tc')
  })

  it('carries a picture across, and counts one that is only linked', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4])
    const frames =
      '<draw:frame svg:x="0in" svg:y="0in" svg:width="2in" svg:height="2in"><draw:image xlink:href="Pictures/a.png"/></draw:frame>' +
      '<draw:frame svg:x="0in" svg:y="0in" svg:width="2in" svg:height="2in"><draw:image xlink:href="../elsewhere.png"/></draw:frame>'
    const file = await odp({
      'content.xml': content(`<draw:page>${frames}</draw:page>`),
      'Pictures/a.png': png,
    })

    const deck = await readOdp(file)
    expect(deck.pages[0]?.shapes).toHaveLength(1)
    expect(deck.skipped).toBe(1)
  })

  it('counts the drawn shapes it cannot bring across', async () => {
    const page = '<draw:page><draw:custom-shape/><draw:line/><draw:ellipse/></draw:page>'
    expect((await readOdp(await odp({ 'content.xml': content(page) }))).skipped).toBe(3)
  })
})

describe('importing one as a deck', () => {
  it('becomes a deck our own reader opens', async () => {
    const file = await odp({
      'content.xml': content(
        `<draw:page>${textFrame('<text:p>First</text:p>')}</draw:page><draw:page>${textFrame('<text:p>Second</text:p>')}</draw:page>`,
      ),
    })

    const imported = await deckFromOdp(await readOdp(file))
    const deck = readDeck(await readPptxPackage(imported.bytes))

    expect(deck.slides).toHaveLength(2)
  })

  it('puts the words where the frame was', async () => {
    const file = await odp({
      'content.xml': content(`<draw:page>${textFrame('<text:p>Hello</text:p>')}</draw:page>`),
    })

    const imported = await deckFromOdp(await readOdp(file))
    const deck = readDeck(await readPptxPackage(imported.bytes))
    const shapes = flatten(deck.slides[0]?.shapes ?? [])
    const shape = shapes[0]

    // One shape, not three: the title and subtitle a new deck starts with are
    // gone, because the file did not ask for them.
    expect(shapes).toHaveLength(1)
    expect(shape?.text == null ? '' : textOfBody(shape.text)).toBe('Hello')
    expect(shape?.transform?.x).toBe(EMU_PER_INCH)
  })

  it('takes the page size with it', async () => {
    const file = await odp({
      'content.xml': content('<draw:page/>'),
      'styles.xml': styles('10in', '7.5in'),
    })

    const imported = await deckFromOdp(await readOdp(file))
    const deck = readDeck(await readPptxPackage(imported.bytes))

    expect(deck.slideSize.width).toBe(10 * EMU_PER_INCH)
  })

  it('reports what did not come across', async () => {
    const page = '<draw:page><draw:custom-shape/></draw:page>'
    const imported = await deckFromOdp(await readOdp(await odp({ 'content.xml': content(page) })))
    expect(imported.skipped).toBe(1)
  })
})

describe('writing one out', () => {
  const load = async (name: string) =>
    readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

  it('says what it is in its first entry, uncompressed', async () => {
    const pkg = await load('shapes')
    const written = await writeOdp(pkg, readDeck(pkg))
    const back = await readPackage(written.bytes)

    // The magic bytes a reader looks for before it unzips anything.
    expect([...back.parts.keys()][0]).toBe('mimetype')
    expect(new TextDecoder().decode(back.parts.get('mimetype')?.bytes)).toBe(
      'application/vnd.oasis.opendocument.presentation',
    )
  })

  it('writes a page per slide', async () => {
    const pkg = await load('many-slides')
    const deck = readDeck(pkg)
    const written = await writeOdp(pkg, deck)

    const back = await readOdp(written.bytes)
    expect(back.pages).toHaveLength(deck.slides.length)
  })

  it('comes back through our own reader with the words intact', async () => {
    const pkg = await load('text-formatting')
    const deck = readDeck(pkg)
    const said = flatten(deck.slides[0]?.shapes ?? [])
      .filter((shape) => shape.text !== null)
      .map((shape) => (shape.text === null ? '' : textOfBody(shape.text)))

    const back = await readOdp((await writeOdp(pkg, deck)).bytes)
    const written = (back.pages[0]?.shapes ?? []).flatMap((shape) =>
      shape.kind === 'text' ? [shape.lines.map((line) => line.text).join('\n')] : [],
    )

    for (const text of said) expect(written).toContain(text)
  })

  it('carries the pictures', async () => {
    const pkg = await load('picture')
    const written = await writeOdp(pkg, readDeck(pkg))
    const back = await readPackage(written.bytes)

    expect([...back.parts.keys()].some((path) => path.startsWith('Pictures/'))).toBe(true)
  })

  it('counts the shapes it could not write rather than dropping them quietly', async () => {
    // A table is a graphic frame: not words, not a picture, and not something
    // OpenDocument would take as either.
    const pkg = await load('table')
    const written = await writeOdp(pkg, readDeck(pkg))
    expect(written.skipped).toBeGreaterThan(0)
  })
})
