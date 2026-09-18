import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, parseRelationships } from '@orangery/ooxml-core'
import { backgroundOf, readBackground } from './background'
import { readDeck } from './deck'
import { relsPartFor } from './insert-picture'
import { readPptxPackage } from './parts'
import { saveDeck, writePart } from './save'
import { readThemes } from './theme-context'
import {
  masterShapesShown,
  showMasterShapes,
  writeBackground,
  writeBackgroundPicture,
} from './write-background'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

const ORANGE = {
  kind: 'solid' as const,
  color: { source: { kind: 'srgb' as const, hex: '#FF7A00' }, transforms: [] },
}

/** Sets a background on the first slide, saves and reopens. */
async function paint(fill: Parameters<typeof writeBackground>[1]) {
  const pkg = await load('empty')
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('fixture changed')

  const changed = writeBackground(slide, fill)
  writePart(pkg, slide.path, slide.root)

  const reopened = await readPptxPackage(await saveDeck(pkg))
  const reread = readDeck(reopened)
  const first = reread.slides[0]
  if (first === undefined) throw new Error('lost the slide')

  return {
    changed,
    pkg: reopened,
    slide: first,
    background: readBackground(first, undefined),
  }
}

describe('setting a background', () => {
  it('paints the slide the colour it was given', async () => {
    const { changed, background } = await paint(ORANGE)

    expect(changed).toBe(true)
    expect(background?.fill).toEqual(ORANGE)
  })

  it('writes the effect list the schema requires', async () => {
    // Without it PowerPoint offers to repair the file.
    const { pkg } = await paint(ORANGE)

    expect(getPartText(pkg, 'ppt/slides/slide1.xml') ?? '').toContain('a:effectLst')
  })

  it('puts the background before the shapes, as the schema has it', async () => {
    const { pkg } = await paint(ORANGE)
    const text = getPartText(pkg, 'ppt/slides/slide1.xml') ?? ''

    expect(text.indexOf('p:bg')).toBeLessThan(text.indexOf('p:spTree'))
  })

  it('writes a gradient with its stops and angle', async () => {
    const { background } = await paint({
      kind: 'gradient',
      stops: [
        { position: 0, color: { source: { kind: 'srgb', hex: '#FF7A00' }, transforms: [] } },
        { position: 1, color: { source: { kind: 'srgb', hex: '#000000' }, transforms: [] } },
      ],
      angle: 5400000,
      radial: false,
    })

    expect(background?.fill).toEqual({
      kind: 'gradient',
      stops: [
        { position: 0, color: { source: { kind: 'srgb', hex: '#FF7A00' }, transforms: [] } },
        { position: 1, color: { source: { kind: 'srgb', hex: '#000000' }, transforms: [] } },
      ],
      angle: 5400000,
      radial: false,
    })
  })

  it('refuses a gradient with one stop, which is a colour', async () => {
    const pkg = await load('empty')
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture changed')

    expect(
      writeBackground(slide, { kind: 'gradient', stops: [], angle: null, radial: false }),
    ).toBe(false)
  })

  it('replaces a reference into the theme rather than sitting beside it', async () => {
    const { pkg } = await paint(ORANGE)
    const text = getPartText(pkg, 'ppt/slides/slide1.xml') ?? ''

    expect(text).not.toContain('p:bgRef')
  })
})

describe('clearing a background', () => {
  it('sends the slide back to inheriting the master', async () => {
    const pkg = await load('empty')
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    if (slide === undefined) throw new Error('fixture changed')

    writeBackground(slide, ORANGE)
    expect(writeBackground(slide, null)).toBe(true)
    writePart(pkg, slide.path, slide.root)

    const reread = readDeck(await readPptxPackage(await saveDeck(pkg)))
    const first = reread.slides[0]
    if (first === undefined) throw new Error('lost the slide')

    // Nothing of its own, and what it is drawn on comes from further up.
    expect(readBackground(first, undefined)).toBeNull()
    const theme = [...readThemes(pkg, reread).values()][0]
    expect(backgroundOf(reread, first, theme).from).not.toBe(first.path)
  })

  it('reports nothing done for a slide that states none', async () => {
    const pkg = await load('empty')
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture changed')

    expect(writeBackground(slide, null)).toBe(false)
  })

  it('is not the same as a background of none', async () => {
    const { background } = await paint({ kind: 'none' })
    expect(background?.fill).toEqual({ kind: 'none' })
  })
})

describe('a picture behind the slide', () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  it('adds the bytes, the content type and the relationship', async () => {
    const pkg = await load('empty')
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    if (slide === undefined) throw new Error('fixture changed')

    expect(writeBackgroundPicture(pkg, slide, { fileName: 'back.png', bytes: PNG })).toBe(true)
    writePart(pkg, slide.path, slide.root)

    const reopened = await readPptxPackage(await saveDeck(pkg))
    const relationships = parseRelationships(
      getPartText(reopened, relsPartFor('ppt/slides/slide1.xml')) ?? '',
    )

    expect([...reopened.parts.keys()].some((path) => path.startsWith('ppt/media/'))).toBe(true)
    expect(getPartText(reopened, '[Content_Types].xml') ?? '').toContain('png')
    expect([...relationships.values()].some((one) => one.target.includes('media/'))).toBe(true)
  })

  it('is read back as a picture fill', async () => {
    const pkg = await load('empty')
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    if (slide === undefined) throw new Error('fixture changed')

    writeBackgroundPicture(pkg, slide, { fileName: 'back.png', bytes: PNG })
    writePart(pkg, slide.path, slide.root)

    const reread = readDeck(await readPptxPackage(await saveDeck(pkg)))
    const first = reread.slides[0]
    if (first === undefined) throw new Error('lost the slide')

    expect(readBackground(first, undefined)?.fill?.kind).toBe('picture')
  })
})

describe("the master's own shapes", () => {
  it('are shown unless the slide says otherwise', async () => {
    const pkg = await load('empty')
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture changed')

    expect(masterShapesShown(slide)).toBe(true)
  })

  it('stay hidden across a save', async () => {
    const pkg = await load('empty')
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture changed')

    expect(showMasterShapes(slide, false)).toBe(true)
    writePart(pkg, slide.path, slide.root)

    const reread = readDeck(await readPptxPackage(await saveDeck(pkg)))
    const first = reread.slides[0]
    if (first === undefined) throw new Error('lost the slide')

    expect(masterShapesShown(first)).toBe(false)
  })

  it('leave no attribute behind when shown again', async () => {
    // A file says as little as it can; the default is already "shown".
    const pkg = await load('empty')
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture changed')

    showMasterShapes(slide, false)
    expect(showMasterShapes(slide, true)).toBe(true)
    writePart(pkg, slide.path, slide.root)

    expect(getPartText(pkg, 'ppt/slides/slide1.xml') ?? '').not.toContain('showMasterSp')
  })

  it('report nothing done when they are already that way', async () => {
    const pkg = await load('empty')
    const slide = readDeck(pkg).slides[0]
    if (slide === undefined) throw new Error('fixture changed')

    expect(showMasterShapes(slide, true)).toBe(false)
  })
})
