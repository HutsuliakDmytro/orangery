import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import { reorderShapes } from './z-order'
import type { Shape } from './shape-tree'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

/** Reorders on the first slide, saves, reopens, and reports the new order. */
async function reorder(
  pick: (shapes: Shape[]) => Shape[],
  move: Parameters<typeof reorderShapes>[2],
) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('fixture has no slides')

  const moved = reorderShapes(slide, pick(slide.shapes), move)
  writeSlidePart(pkg, slide)

  const reopened = readDeck(await readPptxPackage(await saveDeck(pkg)))
  return { moved, names: reopened.slides[0]?.shapes.map((shape) => shape.name) ?? [] }
}

const START = ['Rectangle 1', 'Oval 2', 'Right Arrow 3', '5-Point Star 4']

/** Picks shapes by position, without asserting they are there in the types. */
const at =
  (...indices: number[]) =>
  (shapes: Shape[]): Shape[] =>
    indices.flatMap((index) => {
      const shape = shapes[index]
      return shape === undefined ? [] : [shape]
    })

describe('bringing a shape forward', () => {
  it('moves it one place later, which is one place nearer the front', async () => {
    // There is no z attribute: what is drawn last is in front.
    const { names } = await reorder(at(0), 'forward')
    expect(names).toEqual(['Oval 2', 'Rectangle 1', 'Right Arrow 3', '5-Point Star 4'])
  })

  it('moves it to the end for the front', async () => {
    const { names } = await reorder(at(0), 'front')
    expect(names).toEqual(['Oval 2', 'Right Arrow 3', '5-Point Star 4', 'Rectangle 1'])
  })

  it('reports nothing done when it is already in front', async () => {
    // So the caller leaves no undo step behind.
    const { moved, names } = await reorder(at(3), 'front')

    expect(moved).toBe(false)
    expect(names).toEqual(START)
  })
})

describe('sending a shape back', () => {
  it('moves it one place earlier', async () => {
    const { names } = await reorder(at(2), 'backward')
    expect(names).toEqual(['Rectangle 1', 'Right Arrow 3', 'Oval 2', '5-Point Star 4'])
  })

  it('moves it to the front of the list for the back', async () => {
    const { names } = await reorder(at(3), 'back')
    expect(names).toEqual(['5-Point Star 4', 'Rectangle 1', 'Oval 2', 'Right Arrow 3'])
  })

  it('reports nothing done when it is already at the back', async () => {
    const { moved } = await reorder(at(0), 'back')
    expect(moved).toBe(false)
  })
})

describe('several shapes at once', () => {
  it('keeps their order among themselves', async () => {
    // Raising them one at a time would swap them past each other.
    const { names } = await reorder(at(0, 1), 'front')
    expect(names).toEqual(['Right Arrow 3', '5-Point Star 4', 'Rectangle 1', 'Oval 2'])
  })

  it('moves a block that is not contiguous', async () => {
    const { names } = await reorder(at(0, 2), 'back')
    expect(names).toEqual(['Rectangle 1', 'Right Arrow 3', 'Oval 2', '5-Point Star 4'])
  })
})

describe('what is not a shape', () => {
  it("never moves anything before the tree's own properties", async () => {
    // p:nvGrpSpPr and p:grpSpPr come first and are not shapes; a shape before
    // them makes PowerPoint refuse the file.
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
    const deck = readDeck(pkg)
    const slide = deck.slides[0]
    if (slide === undefined) throw new Error('fixture has no slides')

    reorderShapes(slide, at(3)(slide.shapes), 'back')
    writeSlidePart(pkg, slide)

    const text = (await readPptxPackage(await saveDeck(pkg))).parts.get(slide.path)?.text ?? ''
    expect(text.indexOf('<p:nvGrpSpPr>')).toBeLessThan(text.indexOf('<p:sp>'))
  })
})
