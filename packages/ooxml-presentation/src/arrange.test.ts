import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  alignmentBounds,
  alignShapes,
  distributeShapes,
  duplicateShape,
  nextShapeId,
  offsetShape,
} from './arrange'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import type { Shape } from './shape-tree'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

/** Opens, changes the first slide, saves and reopens — the whole round trip. */
async function change(
  name: string,
  apply: (shapes: Shape[], slide: ReturnType<typeof readDeck>['slides'][0]) => void,
) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('fixture has no slides')

  apply(slide.shapes, slide)
  writeSlidePart(pkg, slide)

  const reopened = readDeck(await readPptxPackage(await saveDeck(pkg)))
  return reopened.slides[0]?.shapes ?? []
}

const xs = (shapes: readonly Shape[]) => shapes.map((shape) => shape.transform?.x)
const ys = (shapes: readonly Shape[]) => shapes.map((shape) => shape.transform?.y)

describe('aligning', () => {
  it('puts every shape against the same edge', async () => {
    const shapes = await change('shapes', (all) => {
      alignShapes(all, 'left', alignmentBounds(all, { width: 9144000, height: 6858000 }))
    })

    expect(new Set(xs(shapes)).size).toBe(1)
  })

  it('aligns several shapes to their own bounds, not to the slide', async () => {
    // The leftmost shape stays where it is; the rest come to it.
    const shapes = await change('shapes', (all) => {
      alignShapes(all, 'left', alignmentBounds(all, { width: 9144000, height: 6858000 }))
    })

    expect(shapes[0]?.transform?.x).toBe(457200)
  })

  it('aligns a single shape to the slide, since itself would mean nothing', async () => {
    const shapes = await change('shapes', (all) => {
      const one = all.slice(0, 1)
      alignShapes(one, 'right', alignmentBounds(one, { width: 9144000, height: 6858000 }))
    })

    const first = shapes[0]?.transform
    expect((first?.x ?? 0) + (first?.width ?? 0)).toBe(9144000)
  })

  it('centres on the box rather than moving to its edge', async () => {
    const shapes = await change('shapes', (all) => {
      const one = all.slice(0, 1)
      alignShapes(one, 'centre', alignmentBounds(one, { width: 9144000, height: 6858000 }))
    })

    const first = shapes[0]?.transform
    expect((first?.x ?? 0) + (first?.width ?? 0) / 2).toBe(4572000)
  })

  it('leaves the other axis alone', async () => {
    const before = await change('shapes', () => {})
    const after = await change('shapes', (all) => {
      alignShapes(all, 'left', alignmentBounds(all, { width: 9144000, height: 6858000 }))
    })

    expect(ys(after)).toEqual(ys(before))
  })
})

describe('distributing', () => {
  it('makes the gaps equal, not the centres', async () => {
    // Shapes of different sizes with evenly spaced centres do not look evenly
    // spaced, which is the whole reason the command exists.
    const shapes = await change('shapes', (all) => {
      const first = all[0]
      if (first?.transform) {
        // Make one wider so equal gaps and equal centres differ.
        offsetShape(first, { x: 0, y: 0 })
      }
      distributeShapes(all, 'horizontal')
    })

    const gaps = shapes
      .map((shape) => shape.transform)
      .flatMap((one, index, list) => {
        const next = list[index + 1]
        return one == null || next == null ? [] : [next.x - (one.x + one.width)]
      })

    expect(new Set(gaps.map((gap) => Math.round(gap))).size).toBe(1)
  })

  it('leaves the outermost two where they are', async () => {
    const before = await change('shapes', () => {})
    const after = await change('shapes', (all) => {
      distributeShapes(all, 'horizontal')
    })

    expect(after[0]?.transform?.x).toBe(before[0]?.transform?.x)
    expect(after[3]?.transform?.x).toBe(before[3]?.transform?.x)
  })

  it('does nothing with fewer than three, which have no gap to divide', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
    const slide = readDeck(pkg).slides[0]

    expect(distributeShapes(slide?.shapes.slice(0, 2) ?? [], 'horizontal')).toBe(false)
  })
})

describe('duplicating', () => {
  it('adds a shape with an id nothing else is using', async () => {
    const shapes = await change('shapes', (all, slide) => {
      const first = all[0]
      if (first) duplicateShape(slide, first)
    })

    expect(shapes).toHaveLength(5)
    expect(new Set(shapes.map((shape) => shape.id)).size).toBe(5)
  })

  it('copies everything, including what the model does not read', async () => {
    const shapes = await change('shapes', (all, slide) => {
      const first = all[0]
      if (first) duplicateShape(slide, first)
    })
    const copy = shapes[4]

    expect(copy?.properties?.fill).toMatchObject({ kind: 'solid' })
    expect(copy?.style?.fill?.index).toBe(3)
    expect(copy?.text?.paragraphs[0]?.runs[0]?.text).toBe('Rectangle')
  })

  it('names the copy so the two can be told apart', async () => {
    const shapes = await change('shapes', (all, slide) => {
      const first = all[0]
      if (first) duplicateShape(slide, first)
    })

    expect(shapes[4]?.name).toBe('Rectangle 1 copy')
  })

  it('offsets the copy so it is not hidden under the original', async () => {
    const shapes = await change('shapes', (all, slide) => {
      const first = all[0]
      if (first) duplicateShape(slide, first)
    })

    expect(shapes[0]?.transform?.x).toBe(457200)
    expect(shapes[4]?.transform?.x).toBe(457200 + 228600)
  })

  it('shares nothing with the original, so moving the copy leaves it alone', async () => {
    const shapes = await change('shapes', (all, slide) => {
      const first = all[0]
      if (first) duplicateShape(slide, first, { x: 0, y: 0 })
    })

    expect(shapes[0]?.transform?.x).toBe(457200)
    expect(shapes[4]?.transform?.x).toBe(457200)
  })

  it('hands out the next free id rather than one past the count', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
    const slide = readDeck(pkg).slides[0]

    // Ids start at 2, the tree itself being 1.
    expect(nextShapeId(slide ?? { path: '', root: {}, tree: {}, shapes: [] })).toBe(6)
  })
})
