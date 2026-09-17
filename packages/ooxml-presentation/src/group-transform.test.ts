import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { absoluteTransform, throughGroup, withAncestors } from './group-transform'
import type { Transform } from './shape-tree'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const deckOf = async (name: string) =>
  readDeck(await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`))))

const transform = (values: Partial<Transform>): Transform => ({
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  rotation: 0,
  flipHorizontal: false,
  flipVertical: false,
  child: null,
  ...values,
})

describe('throughGroup', () => {
  it('maps a child from the group space onto the slide', () => {
    const group = transform({
      x: 1000,
      y: 2000,
      width: 400,
      height: 200,
      child: { x: 0, y: 0, width: 200, height: 200 },
    })
    const child = transform({ x: 100, y: 50, width: 50, height: 50 })

    // The group is twice as wide as the space its children are written in.
    expect(throughGroup(child, group)).toMatchObject({
      x: 1200,
      y: 2050,
      width: 100,
      height: 50,
    })
  })

  it('leaves a child alone when the group states no child space', () => {
    const group = transform({ x: 10, y: 10, width: 100, height: 100 })
    const child = transform({ x: 5, y: 5, width: 20, height: 20 })

    expect(throughGroup(child, group)).toEqual(child)
  })

  it('refuses to scale by a zero-sized child space', () => {
    // Dividing by it would send every child to a single point.
    const group = transform({ width: 100, height: 100, child: { x: 0, y: 0, width: 0, height: 0 } })
    const child = transform({ x: 5, y: 5, width: 20, height: 20 })

    expect(throughGroup(child, group)).toEqual(child)
  })
})

describe('a group in a real deck', () => {
  it('states a child space that differs from where it sits', async () => {
    const deck = await deckOf('groups-and-connectors')
    const group = deck.slides[0]?.shapes.find((shape) => shape.kind === 'grpSp')

    expect(group?.transform).toMatchObject({ x: 4572000, width: 2743200 })
    expect(group?.transform?.child).toMatchObject({ x: 914400, width: 2286000 })
  })

  it('puts a child where it really is, not where its own off says', async () => {
    // The child states x=914400 and actually sits at 4572000 — read directly it
    // lands at the far left of the slide instead of the middle right.
    const deck = await deckOf('groups-and-connectors')
    const slide = deck.slides[0]
    const entry = withAncestors(slide?.shapes ?? []).find(
      ({ shape }) => shape.name === 'Rectangle 5',
    )
    if (entry === undefined) throw new Error('fixture changed')

    expect(entry.shape.transform?.x).toBe(914400)
    expect(entry.ancestors.map((shape) => shape.kind)).toEqual(['grpSp'])
    expect(absoluteTransform(entry.shape.transform, entry.ancestors)).toMatchObject({
      x: 4572000,
      y: 3657600,
    })
  })

  it('scales the child by the ratio between the two rectangles', async () => {
    // The group is 1.2 times the width of its child space, so a child is too.
    const deck = await deckOf('groups-and-connectors')
    const entry = withAncestors(deck.slides[0]?.shapes ?? []).find(
      ({ shape }) => shape.name === 'Oval 6',
    )
    if (entry === undefined) throw new Error('fixture changed')

    expect(entry.shape.transform?.width).toBe(914400)
    expect(absoluteTransform(entry.shape.transform, entry.ancestors)?.width).toBeCloseTo(
      914400 * 1.2,
      0,
    )
  })

  it('leaves a shape outside any group untouched', async () => {
    const deck = await deckOf('groups-and-connectors')
    const entry = withAncestors(deck.slides[0]?.shapes ?? []).find(
      ({ shape }) => shape.name === 'Rounded Rectangle 1',
    )
    if (entry === undefined) throw new Error('fixture changed')

    expect(entry.ancestors).toEqual([])
    expect(absoluteTransform(entry.shape.transform, entry.ancestors)).toEqual(entry.shape.transform)
  })
})

describe('pictures and connectors', () => {
  it('reads the image a picture shows, and that it is uncropped', async () => {
    const deck = await deckOf('picture')
    const picture = deck.slides[0]?.shapes[0]

    expect(picture?.picture).toEqual({
      relationshipId: 'rId2',
      crop: { left: 0, top: 0, right: 0, bottom: 0 },
      mode: 'stretch',
    })
  })

  it('reads which shapes a connector is pinned to', async () => {
    const deck = await deckOf('groups-and-connectors')
    const shapes = deck.slides[0]?.shapes ?? []
    const connector = shapes.find((shape) => shape.kind === 'cxnSp')
    const [from, to] = shapes.filter((shape) => shape.name.startsWith('Rounded Rectangle'))

    // Taken from the shapes rather than written out, so the fixture can grow
    // without this becoming a test of which ids python-pptx handed out.
    expect(connector?.connection?.start?.shapeId).toBe(from?.id)
    expect(connector?.connection?.end?.shapeId).toBe(to?.id)
    expect(connector?.connection?.start?.site).toBe(3)
  })

  it('leaves a plain shape without either', async () => {
    const deck = await deckOf('shapes')
    const [rectangle] = deck.slides[0]?.shapes ?? []

    expect(rectangle?.picture).toBeNull()
    expect(rectangle?.connection).toBeNull()
  })
})
