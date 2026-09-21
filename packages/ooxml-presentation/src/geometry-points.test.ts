import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, parseXml, serializeNode } from '@orangery/ooxml-core'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import { flatten, parseShape } from './shape-tree'
import type { Shape } from './shape-tree'
import {
  addGeometryPoint,
  geometryPoints,
  moveGeometryPoint,
  pathIsClosed,
  pathSpace,
  removeGeometryPoint,
} from './geometry-points'

/**
 * The vertices of a shape's own outline.
 *
 * The case that matters is the one the path reader refuses: a shape holding an
 * arc cannot be drawn faithfully, and its points are still points. Anything
 * that worked only on shapes we can draw would be useless on exactly the files
 * where somebody wants to fix a vertex by hand.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

/** A shape from raw XML, for the cases no fixture has. */
function shapeOf(xml: string): Shape {
  const parsed = parseXml(xml)[0]
  const shape = parsed === undefined ? null : parseShape(parsed)
  if (shape === null) throw new Error('not a shape')
  return shape
}

const triangle = (
  points = '<a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:lnTo><a:pt x="100" y="0"/></a:lnTo><a:lnTo><a:pt x="50" y="100"/></a:lnTo><a:close/>',
) =>
  shapeOf(
    `<p:sp><p:nvSpPr><p:cNvPr id="2" name="Custom"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:custGeom><a:avLst/><a:pathLst><a:path w="100" h="100">${points}</a:path></a:pathLst></a:custGeom></p:spPr></p:sp>`,
  )

describe('reading the vertices', () => {
  it('lists every point in order', () => {
    expect(geometryPoints(triangle())).toEqual([
      { path: 0, index: 0, x: 0, y: 0, vertex: true },
      { path: 0, index: 1, x: 100, y: 0, vertex: true },
      { path: 0, index: 2, x: 50, y: 100, vertex: true },
    ])
  })

  it('says the space they are written in', () => {
    expect(pathSpace(triangle(), 0)).toEqual({ width: 100, height: 100 })
  })

  it('finds nothing on a shape with a preset outline', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
    const shape = flatten(readDeck(pkg).slides[0]?.shapes ?? [])[0]
    if (shape === undefined) throw new Error('fixture has no shapes')

    expect(geometryPoints(shape)).toEqual([])
  })

  it('reads the points of a shape the path reader gives up on', () => {
    // An arc cannot be drawn faithfully, so `readCustomGeometry` answers null —
    // and the points beside it are still points.
    const withArc = triangle(
      '<a:moveTo><a:pt x="0" y="0"/></a:moveTo><a:arcTo wR="50" hR="50" stAng="0" swAng="5400000"/><a:lnTo><a:pt x="50" y="100"/></a:lnTo>',
    )

    expect(withArc.properties?.geometry?.paths).toBeNull()
    expect(geometryPoints(withArc)).toHaveLength(2)
  })
})

describe('moving one', () => {
  it('writes the new position', () => {
    const shape = triangle()
    expect(moveGeometryPoint(shape, { path: 0, index: 2 }, { x: 20, y: 80 })).toBe(true)

    expect(geometryPoints(shape)[2]).toEqual({ path: 0, index: 2, x: 20, y: 80, vertex: true })
  })

  it('leaves every other point alone', () => {
    const shape = triangle()
    moveGeometryPoint(shape, { path: 0, index: 1 }, { x: 60, y: 10 })

    const points = geometryPoints(shape)
    expect(points[0]).toMatchObject({ x: 0, y: 0 })
    expect(points[2]).toMatchObject({ x: 50, y: 100 })
  })

  it('keeps the point inside the path space', () => {
    const shape = triangle()
    moveGeometryPoint(shape, { path: 0, index: 0 }, { x: -50, y: 900 })

    // Outside it, the shape looks to whoever is dragging like it came apart.
    expect(geometryPoints(shape)[0]).toMatchObject({ x: 0, y: 100 })
  })

  it('does nothing for a point that is not there', () => {
    expect(moveGeometryPoint(triangle(), { path: 0, index: 9 }, { x: 1, y: 1 })).toBe(false)
    expect(moveGeometryPoint(triangle(), { path: 4, index: 0 }, { x: 1, y: 1 })).toBe(false)
  })

  it('leaves the rest of the geometry untouched', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    if (slide === undefined) throw new Error('fixture has no slides')

    const before = getPartText(pkg, slide.path)
    writeSlidePart(pkg, slide)
    const after = getPartText(await readPptxPackage(await saveDeck(pkg)), slide.path)

    // Nothing was moved, so nothing changed: the guard that this does not
    // rebuild what it did not touch.
    expect(after).toBe(before)
  })
})

/** A square, which has one corner more than the least an outline can be. */
const square = () =>
  triangle(
    '<a:moveTo><a:pt x="0" y="0"/></a:moveTo>' +
      '<a:lnTo><a:pt x="100" y="0"/></a:lnTo>' +
      '<a:lnTo><a:pt x="100" y="100"/></a:lnTo>' +
      '<a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/>',
  )

/** A square whose last side is a curve, so it holds handles as well as corners. */
const curved = () =>
  triangle(
    '<a:moveTo><a:pt x="0" y="0"/></a:moveTo>' +
      '<a:lnTo><a:pt x="100" y="0"/></a:lnTo>' +
      '<a:lnTo><a:pt x="100" y="100"/></a:lnTo>' +
      '<a:cubicBezTo><a:pt x="70" y="120"/><a:pt x="30" y="120"/><a:pt x="0" y="100"/>' +
      '</a:cubicBezTo><a:close/>',
  )

describe('telling a corner from a handle', () => {
  it('calls the point a curve arrives at a corner and its handles not', () => {
    const points = geometryPoints(curved())

    // Three corners, then two handles and the corner they curve towards.
    expect(points.map((point) => point.vertex)).toEqual([true, true, true, false, false, true])
  })
})

describe('adding a vertex', () => {
  it('puts a straight segment in after the corner named', () => {
    const shape = square()
    expect(addGeometryPoint(shape, { path: 0, index: 1 }, { x: 100, y: 50 })).toBe(true)

    // A corner somebody pointed at is a corner, not a curve through it.
    expect(geometryPoints(shape).map((point) => [point.x, point.y])).toEqual([
      [0, 0],
      [100, 0],
      [100, 50],
      [100, 100],
      [0, 100],
    ])
  })

  it('keeps the new corner inside the path’s own space', () => {
    const shape = square()
    addGeometryPoint(shape, { path: 0, index: 1 }, { x: 500, y: -20 })

    const added = geometryPoints(shape)[2]
    expect(added).toMatchObject({ x: 100, y: 0 })
  })

  it('goes before the close, so it is part of the outline', () => {
    const shape = square()
    addGeometryPoint(shape, { path: 0, index: 3 }, { x: 0, y: 50 })

    expect(geometryPoints(shape)).toHaveLength(5)
    expect(pathIsClosed(shape, 0)).toBe(true)
  })

  it('refuses to follow a handle, which is not a place on the outline', () => {
    expect(addGeometryPoint(curved(), { path: 0, index: 3 }, { x: 10, y: 10 })).toBe(false)
  })

  it('refuses on a shape with no outline of its own', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
    const shape = flatten(readDeck(pkg).slides[0]?.shapes ?? [])[0]
    if (shape === undefined) throw new Error('fixture has no shapes')

    expect(addGeometryPoint(shape, { path: 0, index: 0 }, { x: 1, y: 1 })).toBe(false)
  })
})

describe('removing a vertex', () => {
  it('takes the corner out and leaves the rest', () => {
    const shape = square()
    expect(removeGeometryPoint(shape, { path: 0, index: 2 })).toBe(true)

    expect(geometryPoints(shape).map((point) => [point.x, point.y])).toEqual([
      [0, 0],
      [100, 0],
      [0, 100],
    ])
  })

  it('takes a curve’s handles with the corner they curve towards', () => {
    const shape = curved()
    expect(removeGeometryPoint(shape, { path: 0, index: 5 })).toBe(true)

    // A curve without the corner it curved towards is not a shorter curve.
    expect(geometryPoints(shape)).toHaveLength(3)
  })

  it('refuses a handle on its own', () => {
    expect(removeGeometryPoint(curved(), { path: 0, index: 3 })).toBe(false)
  })

  it('refuses to leave fewer than three corners', () => {
    // There would be nothing left to draw, and no way to get the shape back.
    expect(removeGeometryPoint(triangle(), { path: 0, index: 1 })).toBe(false)
  })

  it('promotes what follows when the start is the one removed', () => {
    const shape = square()
    expect(removeGeometryPoint(shape, { path: 0, index: 0 })).toBe(true)

    const written = serializeNode(shape.node)
    expect(written.indexOf('a:moveTo')).toBeLessThan(written.indexOf('a:lnTo'))
    expect(geometryPoints(shape).map((point) => [point.x, point.y])).toEqual([
      [100, 0],
      [100, 100],
      [0, 100],
    ])
  })

  it('refuses to promote a curve into a starting position', () => {
    const shape = triangle(
      '<a:moveTo><a:pt x="0" y="0"/></a:moveTo>' +
        '<a:cubicBezTo><a:pt x="20" y="10"/><a:pt x="80" y="10"/><a:pt x="100" y="0"/>' +
        '</a:cubicBezTo>' +
        '<a:lnTo><a:pt x="100" y="100"/></a:lnTo>' +
        '<a:lnTo><a:pt x="0" y="100"/></a:lnTo><a:close/>',
    )

    // Its handles are stated against a corner that would no longer be there.
    expect(removeGeometryPoint(shape, { path: 0, index: 0 })).toBe(false)
  })
})
