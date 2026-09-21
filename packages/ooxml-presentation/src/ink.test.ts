import { describe, expect, it } from 'vitest'
import { parseXml, serializeNode } from '@orangery/ooxml-core'
import type { SlidePart } from './deck'
import { addInkStroke } from './ink'
import { geometryPoints } from './geometry-points'
import { parseShapeTree } from './shape-tree'

/**
 * Keeping what was drawn on a slide during a show.
 *
 * Written as a freeform line rather than as InkML, so the tests are about a
 * shape: where its box is, where its points are, and that it is a line rather
 * than a blot.
 */

function slide(): SlidePart {
  const tree = parseXml(
    '<p:spTree xmlns:p="p" xmlns:a="a"><p:nvGrpSpPr/><p:grpSpPr/></p:spTree>',
  )[0]
  if (tree === undefined) throw new Error('bad fixture')

  return {
    path: 'ppt/slides/slide1.xml',
    root: { 'p:sld': [{ 'p:cSld': [tree] }] },
    tree,
    shapes: parseShapeTree(tree),
  }
}

const line = {
  points: [
    { x: 1000, y: 2000 },
    { x: 5000, y: 2000 },
    { x: 5000, y: 8000 },
  ],
  color: '#FF0000',
  width: 28575,
}

/** The shape a stroke became, read back through the real parser. */
const drawn = (part: SlidePart) => parseShapeTree(part.tree)[0]

describe('a stroke on a slide', () => {
  it('becomes a shape with the outline that was drawn', () => {
    const part = slide()
    expect(addInkStroke(part, line)).not.toBeNull()

    const shape = drawn(part)
    if (shape === undefined) throw new Error('nothing was added')
    expect(geometryPoints(shape).map((point) => [point.x, point.y])).toEqual([
      [0, 0],
      [4000, 0],
      [4000, 6000],
    ])
  })

  it('sits in the box the stroke needs', () => {
    const part = slide()
    addInkStroke(part, line)

    expect(drawn(part)?.transform).toMatchObject({ x: 1000, y: 2000, width: 4000, height: 6000 })
  })

  it('gives a straight stroke a box it can be drawn in', () => {
    // A line across has no height at all, and a shape with none is a shape
    // nothing draws.
    const part = slide()
    addInkStroke(part, {
      ...line,
      points: [
        { x: 0, y: 500 },
        { x: 9000, y: 500 },
      ],
    })

    expect(drawn(part)?.transform?.height).toBe(1)
  })

  it('is a line and not a blot', () => {
    const part = slide()
    addInkStroke(part, line)

    const written = serializeNode(part.tree)
    expect(written).toContain('a:noFill')
    expect(written).toContain('FF0000')
    expect(written).toContain('w="28575"')
  })

  it('is see-through when it was a highlighter', () => {
    const part = slide()
    addInkStroke(part, { ...line, highlight: true, color: '#FFFF00' })

    // Which is what makes it read as marking rather than as writing.
    expect(serializeNode(part.tree)).toContain('a:alpha')
  })

  it('refuses a stroke of one point', () => {
    // A line from somewhere to the same place is what a stray click produces.
    const part = slide()
    expect(addInkStroke(part, { ...line, points: [{ x: 1, y: 1 }] })).toBeNull()
    expect(parseShapeTree(part.tree)).toEqual([])
  })

  it('gives each stroke an id of its own', () => {
    const part = slide()
    addInkStroke(part, line)
    addInkStroke(part, line)

    const ids = parseShapeTree(part.tree).map((shape) => shape.id)
    expect(new Set(ids).size).toBe(2)
  })
})
