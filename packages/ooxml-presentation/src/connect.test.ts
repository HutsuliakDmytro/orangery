import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { connectorEnds, moveConnectorEnd, nearestSite, sitePoint } from './connect'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import { flatten } from './shape-tree'
import type { Shape, Transform } from './shape-tree'

/**
 * Moving the end of a connector.
 *
 * What is easy to get wrong is not the geometry but the pairing: the line and
 * the attachment have to say the same thing, or the line goes where it was
 * dragged and springs back the next time anything moves.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const box = (x: number, y: number, width: number, height: number): Transform => ({
  x,
  y,
  width,
  height,
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  child: null,
})

describe('where a connector ends are', () => {
  it('runs from the top left when it is not flipped', () => {
    expect(connectorEnds(box(100, 200, 50, 60))).toEqual({
      start: { x: 100, y: 200 },
      end: { x: 150, y: 260 },
    })
  })

  it('swaps them when it is', () => {
    const flipped = { ...box(100, 200, 50, 60), flipHorizontal: true, flipVertical: true }
    expect(connectorEnds(flipped)).toEqual({
      start: { x: 150, y: 260 },
      end: { x: 100, y: 200 },
    })
  })
})

describe('the side nearest a point', () => {
  const wide = box(0, 0, 1000, 100)

  it('is measured to the side, not by the quadrant the point falls in', () => {
    // Just above the middle of a very wide shape: the top is far away, the
    // left is near. Quadrants would say top.
    expect(nearestSite(wide, { x: 10, y: 45 })).toBe('left')
  })

  it('picks the obvious one when it is obvious', () => {
    expect(nearestSite(wide, { x: 500, y: -200 })).toBe('top')
    expect(nearestSite(wide, { x: 1200, y: 50 })).toBe('right')
  })

  it('agrees with where it says the point is', () => {
    expect(sitePoint(wide, 'right')).toEqual({ x: 1000, y: 50 })
  })
})

/** Opens a deck with a connector, moves one end, saves and reopens. */
async function move(which: 'start' | 'end', onto: boolean) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'groups-and-connectors.pptx')))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('fixture has no slides')

  const shapes = flatten(slide.shapes)
  const connector = shapes.find((shape) => shape.kind === 'cxnSp')
  const target = shapes.find((shape) => shape.kind === 'sp' && shape.transform !== null)
  if (connector === undefined || target === undefined) throw new Error('fixture has no connector')

  const point = { x: 5_000_000, y: 3_000_000 }
  moveConnectorEnd(connector, which, { point, ...(onto ? { onto: target } : {}) })
  writeSlidePart(pkg, slide)

  const reopened = readDeck(await readPptxPackage(await saveDeck(pkg)))
  const again = flatten(reopened.slides[0]?.shapes ?? []).find(
    (shape) => shape.id === connector.id,
  ) as Shape
  return { connector: again, target }
}

describe('dragging an end onto a shape', () => {
  it('pins it there', async () => {
    const { connector, target } = await move('start', true)
    expect(connector.connection?.start?.shapeId).toBe(target.id)
  })

  it('snaps the line to the side it pinned to', async () => {
    const { connector, target } = await move('start', true)
    const site = connector.connection?.start?.site ?? -1
    const named = (['top', 'left', 'bottom', 'right'] as const)[site]
    if (named === undefined || target.transform === null) throw new Error('no site')

    // A connector that stops a hair short of what it is attached to is what
    // everybody spends five minutes nudging.
    const ends = connectorEnds(connector.transform as Transform)
    expect(ends.start).toEqual(sitePoint(target.transform, named))
  })
})

describe('dragging an end onto nothing', () => {
  it('lets it go rather than leaving it pinned', async () => {
    const { connector } = await move('end', false)
    expect(connector.connection?.end).toBeNull()
  })

  it('leaves the end where the pointer put it', async () => {
    const { connector } = await move('end', false)
    const ends = connectorEnds(connector.transform as Transform)
    expect(ends.end).toEqual({ x: 5_000_000, y: 3_000_000 })
  })

  it('leaves the other end alone', async () => {
    const before = await move('end', false)
    const other = connectorEnds(before.connector.transform as Transform).start
    expect(Number.isFinite(other.x)).toBe(true)
  })
})
