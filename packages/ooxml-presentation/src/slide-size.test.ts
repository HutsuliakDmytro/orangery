import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck } from './save'
import { setSlideSize } from './slide-size'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

const WIDE = { width: 12192000, height: 6858000 }
const STANDARD = { width: 9144000, height: 6858000 }
/** Half a 4:3 slide each way, so the factor is a round 0.5. */
const HALF = { width: 4572000, height: 3429000 }

/**
 * The first thing in a deck that states a position of its own.
 *
 * A placeholder on a slide usually states none — it takes its rectangle from
 * the layout — so a test about positions has to look where one is written down.
 */
function anchor(deck: ReturnType<typeof readDeck>) {
  for (const part of [...deck.slides, ...deck.layouts.values()]) {
    const shape = part.shapes.find((one) => one.transform !== null)
    if (shape !== undefined) return { path: part.path, id: shape.id, transform: shape.transform }
  }
  return null
}

const transformOf = (deck: ReturnType<typeof readDeck>, path: string, id: number) => {
  const part = [...deck.slides, ...deck.layouts.values()].find((one) => one.path === path)
  return part?.shapes.find((one) => one.id === id)?.transform ?? null
}

/** Changes the size, saves and reopens. */
async function resize(name: string, size: typeof WIDE, content: 'maximize' | 'fit') {
  const pkg = await load(name)
  const deck = readDeck(pkg)
  const before = anchor(deck)

  const changed = setSlideSize(pkg, deck, size, content)
  const reopened = await readPptxPackage(await saveDeck(pkg))
  const reread = readDeck(reopened)

  return {
    changed,
    before: before?.transform ?? null,
    after: before === null ? null : transformOf(reread, before.path, before.id),
    pkg: reopened,
    deck: reread,
  }
}

describe('setting the slide size', () => {
  it('states the new size in the presentation', async () => {
    const { changed, deck } = await resize('empty', WIDE, 'maximize')

    expect(changed).toBe(true)
    expect(deck.slideSize).toEqual(WIDE)
  })

  it('labels the size with the preset it matches', async () => {
    const { pkg } = await resize('empty', WIDE, 'maximize')
    expect(getPartText(pkg, 'ppt/presentation.xml') ?? '').toContain('screen16x9')
  })

  it('drops the label for a size that is no preset', async () => {
    // A stale `type` is worse than none: it reads as authoritative.
    const { pkg } = await resize('empty', { width: 8000000, height: 6000000 }, 'maximize')
    expect(getPartText(pkg, 'ppt/presentation.xml') ?? '').not.toContain('type=')
  })

  it('reports nothing done when the deck is already that size', async () => {
    const pkg = await load('empty')
    const deck = readDeck(pkg)

    expect(setSlideSize(pkg, deck, deck.slideSize, 'fit')).toBe(false)
  })

  it('refuses a size of nothing', async () => {
    const pkg = await load('empty')
    expect(setSlideSize(pkg, readDeck(pkg), { width: 0, height: 100 }, 'fit')).toBe(false)
  })
})

describe('keeping the content at its size', () => {
  it('leaves every shape where it was', async () => {
    const { before, after } = await resize('shapes', WIDE, 'maximize')

    expect(before).not.toBeNull()
    expect(after).toEqual(before)
  })

  it('leaves the slide parts untouched', async () => {
    const original = await load('shapes')
    const { pkg } = await resize('shapes', WIDE, 'maximize')

    expect(getPartText(pkg, 'ppt/slides/slide1.xml')).toBe(
      getPartText(original, 'ppt/slides/slide1.xml'),
    )
  })
})

describe('scaling the content to fit', () => {
  it('scales by the smaller ratio, so nothing is distorted', async () => {
    const { before, after } = await resize('sixteen-by-nine', STANDARD, 'fit')

    // 9144000 / 12192000 = 0.75 across, 1 down; the smaller one wins.
    expect(before).not.toBeNull()
    expect(after?.width).toBe(Math.round((before?.width ?? 0) * 0.75))
    expect(after?.height).toBe(Math.round((before?.height ?? 0) * 0.75))
  })

  it('centres what it scaled, rather than leaving it in a corner', async () => {
    const { before, after } = await resize('sixteen-by-nine', STANDARD, 'fit')

    // Down the middle: the letterbox is shared between top and bottom.
    const margin = (6858000 - 6858000 * 0.75) / 2
    expect(after?.y).toBe(Math.round((before?.y ?? 0) * 0.75 + margin))
    expect(after?.x).toBe(Math.round((before?.x ?? 0) * 0.75))
  })

  it('scales the text with the boxes around it', async () => {
    const pkg = await load('text-formatting')
    const deck = readDeck(pkg)

    const sizesOf = (text: string) => [...text.matchAll(/ sz="(\d+)"/gu)].map((m) => Number(m[1]))
    const before = sizesOf(getPartText(pkg, 'ppt/slides/slide1.xml') ?? '')

    setSlideSize(pkg, deck, HALF, 'fit')
    const after = sizesOf(getPartText(pkg, 'ppt/slides/slide1.xml') ?? '')

    expect(before.length).toBeGreaterThan(0)
    expect(after).toEqual(before.map((size) => Math.round(size * 0.5)))
  })

  it('scales the layouts and the masters too', async () => {
    // A slide that scaled while its layout did not would tear away from it.
    const pkg = await load('placeholders')
    const deck = readDeck(pkg)

    const layout = [...deck.layouts.values()][0]
    const before = layout?.shapes[0]?.transform ?? null
    if (layout === undefined || before === null) throw new Error('fixture changed')

    setSlideSize(pkg, deck, HALF, 'fit')
    const after = readDeck(await readPptxPackage(await saveDeck(pkg))).layouts.get(layout.path)

    expect(after?.shapes[0]?.transform?.width).toBe(Math.round(before.width * 0.5))
  })

  it('leaves a group to carry its own children', async () => {
    // A group states the rectangle its children are mapped into, so scaling it
    // scales everything inside once; scaling both would scale them twice.
    const pkg = await load('groups-and-connectors')
    const deck = readDeck(pkg)
    const group = deck.slides[0]?.shapes.find((shape) => shape.shapes.length > 0)
    const child = group?.shapes[0]?.transform
    if (group === undefined || child === undefined) throw new Error('fixture changed')

    setSlideSize(pkg, deck, HALF, 'fit')
    const reread = readDeck(await readPptxPackage(await saveDeck(pkg)))
    const after = reread.slides[0]?.shapes.find((shape) => shape.shapes.length > 0)

    expect(after?.shapes[0]?.transform).toEqual(child)
    expect(after?.transform?.width).toBe(Math.round((group.transform?.width ?? 0) * 0.5))
  })
})
