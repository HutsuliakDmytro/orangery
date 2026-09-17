import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDeck } from './deck'
import { facingSites, insertConnector, SITES } from './insert-connector'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import type { Transform } from './shape-tree'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const at = (x: number, y: number, width = 100, height = 100): Transform => ({
  x,
  y,
  width,
  height,
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  child: null,
})

/** Joins two named shapes on the first slide, saves and reopens. */
async function connect(first: string, second: string) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  const from = slide?.shapes.find((shape) => shape.name === first)
  const to = slide?.shapes.find((shape) => shape.name === second)
  if (slide === undefined || from === undefined || to === undefined) {
    throw new Error('fixture changed')
  }

  insertConnector(slide, { from, to })
  writeSlidePart(pkg, slide)

  const reopened = readDeck(await readPptxPackage(await saveDeck(pkg)))
  return { shapes: reopened.slides[0]?.shapes ?? [], from, to }
}

describe('facingSites', () => {
  it('joins side by side shapes left to right', () => {
    expect(facingSites(at(0, 0), at(500, 0))).toEqual({ start: 'right', end: 'left' })
    expect(facingSites(at(500, 0), at(0, 0))).toEqual({ start: 'left', end: 'right' })
  })

  it('joins stacked shapes top to bottom', () => {
    expect(facingSites(at(0, 0), at(0, 500))).toEqual({ start: 'bottom', end: 'top' })
    expect(facingSites(at(0, 500), at(0, 0))).toEqual({ start: 'top', end: 'bottom' })
  })

  it('goes by the axis they are further apart on', () => {
    // Picking the nearest pair of points instead would join two overlapping
    // shapes across their own middles, drawing a line inside them.
    expect(facingSites(at(0, 0), at(500, 50))).toEqual({ start: 'right', end: 'left' })
    expect(facingSites(at(0, 0), at(50, 500))).toEqual({ start: 'bottom', end: 'top' })
  })
})

describe('inserting a connector', () => {
  it('comes back as a connector', async () => {
    const { shapes } = await connect('Rectangle 1', 'Oval 2')
    expect(shapes[shapes.length - 1]?.kind).toBe('cxnSp')
  })

  it('pins both ends to the shapes it joins', async () => {
    // Without the attachment the line looks connected until something moves.
    const { shapes, from, to } = await connect('Rectangle 1', 'Oval 2')
    const connector = shapes[shapes.length - 1]

    expect(connector?.connection?.start).toEqual({ shapeId: from.id, site: SITES.right })
    expect(connector?.connection?.end).toEqual({ shapeId: to.id, site: SITES.left })
  })

  it('spans the gap between the two edges', async () => {
    const { shapes, from, to } = await connect('Rectangle 1', 'Oval 2')
    const connector = shapes[shapes.length - 1]?.transform
    const right = (from.transform?.x ?? 0) + (from.transform?.width ?? 0)

    expect(connector?.x).toBe(right)
    expect((connector?.x ?? 0) + (connector?.width ?? 0)).toBe(to.transform?.x)
  })

  it('flips rather than taking a negative size when it runs backwards', async () => {
    const { shapes } = await connect('Oval 2', 'Rectangle 1')
    const connector = shapes[shapes.length - 1]?.transform

    expect(connector?.width).toBeGreaterThan(0)
    expect(connector?.flipHorizontal).toBe(true)
  })

  it('takes its line from the theme, like any other new shape', async () => {
    const { shapes } = await connect('Rectangle 1', 'Oval 2')
    const connector = shapes[shapes.length - 1]

    expect(connector?.style?.line?.index).toBe(2)
    // A connector is a line: no fill, which the reference states as zero.
    expect(connector?.style?.fill?.index).toBe(0)
  })

  it('refuses a shape with no transform of its own', async () => {
    // A placeholder inheriting its position has nothing to measure against, and
    // guessing would put the line somewhere plausible and wrong.
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'placeholders.pptx')))
    const slide = readDeck(pkg).slides[0]
    const [title, body] = slide?.shapes ?? []

    expect(
      slide === undefined || title === undefined || body === undefined
        ? null
        : insertConnector(slide, { from: title, to: body }),
    ).toBeNull()
  })
})
