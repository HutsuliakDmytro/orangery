import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDeck } from './deck'
import { absoluteTransform, withAncestors } from './group-transform'
import { groupShapes, ungroupShape } from './group'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import type { Deck, Slide } from './deck'
import type { Shape } from './shape-tree'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

async function change(name: string, apply: (slide: Slide) => void): Promise<Deck> {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('fixture has no slides')

  apply(slide)
  writeSlidePart(pkg, slide)

  return readDeck(await readPptxPackage(await saveDeck(pkg)))
}

/** Where every shape actually sits, groups resolved, by name. */
function positions(deck: Deck): Map<string, { x: number; y: number; width: number }> {
  const slide = deck.slides[0]
  const placed = new Map<string, { x: number; y: number; width: number }>()

  for (const { shape, ancestors } of withAncestors(slide?.shapes ?? [])) {
    const transform = absoluteTransform(shape.transform, ancestors)
    if (transform !== null) {
      placed.set(shape.name, {
        x: Math.round(transform.x),
        y: Math.round(transform.y),
        width: Math.round(transform.width),
      })
    }
  }

  return placed
}

const pick = (slide: Slide, ...names: string[]): Shape[] =>
  names.flatMap((name) => slide.shapes.filter((shape) => shape.name === name))

describe('grouping', () => {
  it('leaves every shape exactly where it was', async () => {
    // The group's child space is set to its own bounds, so the mapping is the
    // identity. Any other choice scales every member the moment it is grouped.
    const before = positions(await change('shapes', () => {}))
    const after = positions(
      await change('shapes', (slide) => {
        groupShapes(slide, pick(slide, 'Rectangle 1', 'Oval 2'))
      }),
    )

    expect(after.get('Rectangle 1')).toEqual(before.get('Rectangle 1'))
    expect(after.get('Oval 2')).toEqual(before.get('Oval 2'))
  })

  it('makes a group whose bounds are the union of what went in', async () => {
    const deck = await change('shapes', (slide) => {
      groupShapes(slide, pick(slide, 'Rectangle 1', 'Oval 2'))
    })
    const group = deck.slides[0]?.shapes.find((shape) => shape.kind === 'grpSp')

    // 457200 to 2468880 + 1828800.
    expect(group?.transform).toMatchObject({ x: 457200, width: 2468880 + 1828800 - 457200 })
  })

  it('sets the child space to the same rectangle, which is what keeps it still', async () => {
    const deck = await change('shapes', (slide) => {
      groupShapes(slide, pick(slide, 'Rectangle 1', 'Oval 2'))
    })
    const group = deck.slides[0]?.shapes.find((shape) => shape.kind === 'grpSp')

    expect(group?.transform?.child).toEqual({
      x: group?.transform?.x,
      y: group?.transform?.y,
      width: group?.transform?.width,
      height: group?.transform?.height,
    })
  })

  it('takes the place of the frontmost member, so nothing changes what it covers', async () => {
    const deck = await change('shapes', (slide) => {
      groupShapes(slide, pick(slide, 'Rectangle 1', 'Right Arrow 3'))
    })
    const kinds = deck.slides[0]?.shapes.map((shape) => shape.kind)

    // Oval was between them and stays in front of neither group nor arrow.
    expect(kinds).toEqual(['sp', 'grpSp', 'sp'])
  })

  it('refuses a group of one', async () => {
    const deck = await change('shapes', (slide) => {
      groupShapes(slide, pick(slide, 'Rectangle 1'))
    })

    expect(deck.slides[0]?.shapes.some((shape) => shape.kind === 'grpSp')).toBe(false)
  })
})

describe('ungrouping', () => {
  it('leaves the children where they were drawn', async () => {
    // The fixture's group scales its children 1.2 times; after ungrouping they
    // have to keep that size, with nothing left to resolve it against.
    const before = positions(await change('groups-and-connectors', () => {}))
    const after = positions(
      await change('groups-and-connectors', (slide) => {
        const group = slide.shapes.find((shape) => shape.kind === 'grpSp')
        if (group) ungroupShape(slide, group)
      }),
    )

    expect(after.get('Rectangle 5')).toEqual(before.get('Rectangle 5'))
    expect(after.get('Oval 6')).toEqual(before.get('Oval 6'))
  })

  it('writes the resolved size down, since the group is gone', async () => {
    const after = await change('groups-and-connectors', (slide) => {
      const group = slide.shapes.find((shape) => shape.kind === 'grpSp')
      if (group) ungroupShape(slide, group)
    })
    const rectangle = after.slides[0]?.shapes.find((shape) => shape.name === 'Rectangle 5')

    // Stated 914400 inside a group 1.2 times its child space.
    expect(rectangle?.transform?.width).toBeCloseTo(914400 * 1.2, 0)
  })

  it('leaves the children where the group was in the drawing order', async () => {
    const after = await change('groups-and-connectors', (slide) => {
      const group = slide.shapes.find((shape) => shape.kind === 'grpSp')
      if (group) ungroupShape(slide, group)
    })

    expect(after.slides[0]?.shapes.map((shape) => shape.name)).toEqual([
      'Rounded Rectangle 1',
      'Rounded Rectangle 2',
      'Connector 3',
      'Rectangle 5',
      'Oval 6',
    ])
  })

  it('does nothing to a shape that is not a group', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
    const slide = readDeck(pkg).slides[0]
    const first = slide?.shapes[0]

    expect(slide && first ? ungroupShape(slide, first) : true).toBe(false)
  })
})

describe('grouping and ungrouping in turn', () => {
  it('puts everything back exactly where it started', async () => {
    const original = positions(await change('shapes', () => {}))

    // Grouped, saved, reopened, then ungrouped from the file that resulted —
    // so the second step reads what the first actually wrote rather than a
    // model that has drifted from it.
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'shapes.pptx')))
    const grouped = readDeck(pkg)
    const first = grouped.slides[0]
    if (first === undefined) throw new Error('fixture has no slides')

    groupShapes(first, pick(first, 'Rectangle 1', 'Oval 2', 'Right Arrow 3'))
    writeSlidePart(pkg, first)

    const reopened = await readPptxPackage(await saveDeck(pkg))
    const deck = readDeck(reopened)
    const second = deck.slides[0]
    const group = second?.shapes.find((shape) => shape.kind === 'grpSp')
    if (second === undefined || group === undefined) throw new Error('nothing was grouped')

    ungroupShape(second, group)
    writeSlidePart(reopened, second)

    const final = positions(readDeck(await readPptxPackage(await saveDeck(reopened))))

    for (const name of ['Rectangle 1', 'Oval 2', 'Right Arrow 3', '5-Point Star 4']) {
      expect(final.get(name), name).toEqual(original.get(name))
    }
  })
})
