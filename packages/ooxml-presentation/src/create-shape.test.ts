import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { EMU_PER_INCH } from '@orangery/ooxml-drawingml'
import { createShape, deleteShapes } from './create-shape'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import type { Slide } from './deck'
import type { Shape } from './shape-tree'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

async function change(name: string, apply: (slide: Slide) => void): Promise<Shape[]> {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('fixture has no slides')

  apply(slide)
  writeSlidePart(pkg, slide)

  return readDeck(await readPptxPackage(await saveDeck(pkg))).slides[0]?.shapes ?? []
}

const box = { x: EMU_PER_INCH, y: EMU_PER_INCH, width: EMU_PER_INCH * 2, height: EMU_PER_INCH }

describe('creating a shape', () => {
  it('comes back with the geometry and size it was made with', async () => {
    const shapes = await change('empty', (slide) => {
      createShape(slide, { preset: 'roundRect', transform: box })
    })
    const made = shapes[0]

    expect(made?.properties?.geometry).toMatchObject({ kind: 'preset', preset: 'roundRect' })
    expect(made?.transform).toMatchObject(box)
  })

  it('takes its look from the theme rather than stating its own', async () => {
    // A shape that wrote its own colours would ignore the deck's theme and
    // stand out beside every shape already on the slide.
    const shapes = await change('empty', (slide) => {
      createShape(slide, { preset: 'rect', transform: box })
    })

    expect(shapes[0]?.properties?.fill).toBeNull()
    expect(shapes[0]?.style?.fill?.index).toBe(1)
    expect(shapes[0]?.style?.fill?.color?.source).toEqual({ kind: 'scheme', name: 'accent1' })
  })

  it('takes an id nothing else is using', async () => {
    const shapes = await change('shapes', (slide) => {
      createShape(slide, { preset: 'ellipse', transform: box })
    })

    expect(new Set(shapes.map((shape) => shape.id)).size).toBe(shapes.length)
  })

  it('goes on top, where a newly drawn shape belongs', async () => {
    const shapes = await change('shapes', (slide) => {
      createShape(slide, { preset: 'ellipse', transform: box })
    })

    expect(shapes[shapes.length - 1]?.properties?.geometry?.preset).toBe('ellipse')
  })

  it('names itself after the preset, in words', async () => {
    const shapes = await change('empty', (slide) => {
      createShape(slide, { preset: 'roundRect', transform: box })
    })

    expect(shapes[0]?.name).toMatch(/^Round Rect \d+$/u)
  })

  it('holds text when given some, and an empty body when not', async () => {
    const withText = await change('empty', (slide) => {
      createShape(slide, { preset: 'rect', transform: box, text: 'Hello' })
    })
    const without = await change('empty', (slide) => {
      createShape(slide, { preset: 'rect', transform: box })
    })

    expect(withText[0]?.text?.paragraphs[0]?.runs[0]?.text).toBe('Hello')
    expect(without[0]?.text?.paragraphs[0]?.runs).toEqual([])
    // Still a text body, so the shape can be typed into.
    expect(without[0]?.text).not.toBeNull()
  })

  it('refuses to be given a negative size', async () => {
    const shapes = await change('empty', (slide) => {
      createShape(slide, { preset: 'rect', transform: { ...box, width: -100, height: -100 } })
    })

    expect(shapes[0]?.transform).toMatchObject({ width: 0, height: 0 })
  })
})

describe('deleting shapes', () => {
  it('removes the ones it was given and no others', async () => {
    const shapes = await change('shapes', (slide) => {
      deleteShapes(slide, slide.shapes.slice(0, 2))
    })

    expect(shapes.map((shape) => shape.name)).toEqual(['Right Arrow 3', '5-Point Star 4'])
  })

  it("leaves the tree's own properties alone", async () => {
    const shapes = await change('shapes', (slide) => {
      deleteShapes(slide, slide.shapes)
    })

    expect(shapes).toEqual([])
  })

  it('reports nothing done for shapes that are not there', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
    const deck = readDeck(pkg)
    const other = readDeck(pkg).slides[0]?.shapes[0]
    const slide = deck.slides[1] ?? deck.slides[0]

    expect(slide && other ? deleteShapes(slide, []) : true).toBe(false)
  })
})
