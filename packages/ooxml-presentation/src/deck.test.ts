import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { children, tagName } from '@orangery/ooxml-core'
import { EMU_PER_INCH } from '@orangery/ooxml-drawingml'
import { layoutOf, masterOf, readDeck } from './deck'
import { readPptxPackage } from './parts'
import { flatten } from './shape-tree'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const deckOf = async (name: string) =>
  readDeck(await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`))))

describe('the tree', () => {
  it('reads slides, layouts and masters', async () => {
    const deck = await deckOf('placeholders')

    expect(deck.slides).toHaveLength(1)
    expect(deck.masters.size).toBe(1)
    expect(deck.layouts.size).toBeGreaterThanOrEqual(11)
  })

  it('reads every layout the master offers, not only the ones in use', async () => {
    // Changing a slide's layout later picks from all of them.
    const deck = await deckOf('empty')
    const used = new Set(deck.slides.map((slide) => slide.layout))

    expect(deck.layouts.size).toBeGreaterThan(used.size)
  })

  it('walks slide to layout to master', async () => {
    const deck = await deckOf('placeholders')
    const [slide] = deck.slides
    const layout = slide ? layoutOf(deck, slide) : null
    const master = layout ? masterOf(deck, layout) : null

    expect(layout?.path).toMatch(/slideLayout/u)
    expect(master?.path).toBe('ppt/slideMasters/slideMaster1.xml')
    expect(master?.theme).toBe('ppt/theme/theme1.xml')
  })

  it('keeps the very element each shape was read from', async () => {
    // ADR 0002: a shape is patched in place, so the node it came from has to
    // survive parsing — and be the element itself, not a copy of its contents.
    const deck = await deckOf('shapes')
    const slide = deck.slides[0]

    expect(tagName(slide?.tree ?? {})).toBe('p:spTree')
    expect(slide?.shapes.map((shape) => tagName(shape.node))).toEqual([
      'p:sp',
      'p:sp',
      'p:sp',
      'p:sp',
    ])
    expect(children(slide?.tree ?? {})).toContain(slide?.shapes[0]?.node)
  })
})

describe('shapes', () => {
  it('reads each shape with its id, name and kind', async () => {
    const deck = await deckOf('shapes')
    const shapes = deck.slides[0]?.shapes ?? []

    expect(shapes).toHaveLength(4)
    expect(shapes.map((shape) => shape.kind)).toEqual(['sp', 'sp', 'sp', 'sp'])
    expect(shapes.map((shape) => shape.name)).toEqual([
      'Rectangle 1',
      'Oval 2',
      'Right Arrow 3',
      '5-Point Star 4',
    ])
    expect(new Set(shapes.map((shape) => shape.id)).size).toBe(4)
  })

  it('reads the transform in EMU', async () => {
    const deck = await deckOf('shapes')
    const [first] = deck.slides[0]?.shapes ?? []

    expect(first?.transform).toEqual({
      x: EMU_PER_INCH / 2,
      y: EMU_PER_INCH * 1.5,
      width: EMU_PER_INCH * 2,
      height: EMU_PER_INCH * 1.5,
      rotation: 0,
      flipHorizontal: false,
      flipVertical: false,
      child: null,
    })
  })

  it('leaves a placeholder without a transform of its own', async () => {
    // Position comes from the layout; writing it into the slide would detach
    // the shape from it.
    const deck = await deckOf('placeholders')
    const shapes = deck.slides[0]?.shapes ?? []

    expect(shapes.every((shape) => shape.placeholder !== null)).toBe(true)
    expect(shapes.every((shape) => shape.transform === null)).toBe(true)
  })

  it('reads which placeholder a shape fills', async () => {
    const deck = await deckOf('placeholders')
    const [title, body] = deck.slides[0]?.shapes ?? []

    expect(title?.placeholder).toEqual({ type: 'title', index: null })
    // A bare `<p:ph idx="1"/>` means the body, which is the schema's default.
    expect(body?.placeholder).toEqual({ type: 'body', index: 1 })
  })

  it('tells a connector and a picture from a shape', async () => {
    const connectors = await deckOf('groups-and-connectors')
    const pictures = await deckOf('picture')

    expect(connectors.slides[0]?.shapes.map((shape) => shape.kind)).toEqual(['sp', 'sp', 'cxnSp'])
    expect(pictures.slides[0]?.shapes.map((shape) => shape.kind)).toEqual(['pic'])
    expect(pictures.slides[0]?.shapes[0]?.description).toBe('sample.png')
  })

  it('reads a table as a graphic frame, which states its transform differently', async () => {
    // `p:graphicFrame` carries a `p:xfrm` of its own rather than an `a:xfrm`
    // inside shape properties.
    const deck = await deckOf('table')
    const frame = deck.slides[0]?.shapes.find((shape) => shape.kind === 'graphicFrame')

    expect(frame).toBeDefined()
    expect(frame?.transform?.width).toBe(EMU_PER_INCH * 8)
  })

  it("skips the tree's own properties, which describe the container", async () => {
    const deck = await deckOf('empty')
    expect(deck.slides[0]?.shapes).toEqual([])
  })
})

describe('flatten', () => {
  it('returns every shape in document order', async () => {
    const deck = await deckOf('shapes')
    const shapes = deck.slides[0]?.shapes ?? []

    expect(flatten(shapes).map((shape) => shape.name)).toEqual(shapes.map((shape) => shape.name))
  })
})
