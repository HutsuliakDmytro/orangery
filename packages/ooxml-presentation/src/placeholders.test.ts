import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { layoutOf, masterOf, readDeck } from './deck'
import { readPptxPackage } from './parts'
import {
  findInLayout,
  findInMaster,
  inheritanceChain,
  masterKindOf,
  resolveTransform,
} from './placeholders'

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

const deckOf = async (name: string) =>
  readDeck(await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`))))

describe('masterKindOf', () => {
  it('folds the title family onto the master title', () => {
    expect(masterKindOf('title')).toBe('title')
    expect(masterKindOf('ctrTitle')).toBe('title')
  })

  it('keeps the three furniture kinds apart', () => {
    expect(masterKindOf('dt')).toBe('dt')
    expect(masterKindOf('ftr')).toBe('ftr')
    expect(masterKindOf('sldNum')).toBe('sldNum')
  })

  it('folds everything that holds content onto the master body', () => {
    // The master has nothing else for them to inherit from.
    for (const type of ['body', 'obj', 'subTitle', 'pic', 'tbl', 'chart', 'dgm', 'media']) {
      expect(masterKindOf(type), type).toBe('body')
    }
  })
})

describe('slide to layout', () => {
  it('matches on the index the slide names', async () => {
    const deck = await deckOf('placeholders')
    const slide = deck.slides[0]
    const layout = slide ? layoutOf(deck, slide) : null
    const body = slide?.shapes.find((shape) => shape.placeholder?.index === 1)

    const found = layout && body?.placeholder ? findInLayout(layout, body.placeholder) : null
    expect(found?.name).toBe('Content Placeholder 2')
  })

  it('matches the title, which states a type and no index', async () => {
    const deck = await deckOf('placeholders')
    const slide = deck.slides[0]
    const layout = slide ? layoutOf(deck, slide) : null
    const title = slide?.shapes.find((shape) => shape.placeholder?.type === 'title')

    const found = layout && title?.placeholder ? findInLayout(layout, title.placeholder) : null
    expect(found?.name).toBe('Title 1')
  })
})

describe('layout to master', () => {
  it('matches on kind, because the indices are unrelated', async () => {
    // This is the trap the three-level scheme sets. In PowerPoint's own default
    // master the date placeholder is idx="2" while the layout's is idx="10".
    const deck = await deckOf('placeholders')
    const slide = deck.slides[0]
    const layout = slide ? layoutOf(deck, slide) : null
    const master = layout ? masterOf(deck, layout) : null
    const date = layout?.shapes.find((shape) => shape.placeholder?.type === 'dt')

    expect(date?.placeholder?.index).toBe(10)

    const found = master && date?.placeholder ? findInMaster(master, date.placeholder) : null
    expect(found?.name).toBe('Date Placeholder 3')
    expect(found?.placeholder?.index).toBe(2)
  })

  it('does not hand a date the title geometry when nothing matches by index', async () => {
    const deck = await deckOf('placeholders')
    const slide = deck.slides[0]
    const layout = slide ? layoutOf(deck, slide) : null
    const master = layout ? masterOf(deck, layout) : null

    const date = master ? findInMaster(master, { type: 'dt', index: 10 }) : null
    expect(date?.placeholder?.type).toBe('dt')
  })
})

describe('the chain', () => {
  it('runs slide, layout, master', async () => {
    const deck = await deckOf('placeholders')
    const slide = deck.slides[0]
    const title = slide?.shapes.find((shape) => shape.placeholder?.type === 'title')

    const chain = slide && title ? inheritanceChain(deck, slide, title) : []
    expect(chain.map((shape) => shape.name)).toEqual(['Title 1', 'Title 1', 'Title Placeholder 1'])
  })

  it('is just the shape itself when it is not a placeholder', async () => {
    const deck = await deckOf('shapes')
    const slide = deck.slides[0]
    const [rectangle] = slide?.shapes ?? []

    const chain = slide && rectangle ? inheritanceChain(deck, slide, rectangle) : []
    expect(chain).toHaveLength(1)
  })
})

describe('resolveTransform', () => {
  it('reaches the master when neither slide nor layout states one', async () => {
    // Both the slide's title and the layout's state no a:xfrm at all here.
    const deck = await deckOf('placeholders')
    const slide = deck.slides[0]
    const title = slide?.shapes.find((shape) => shape.placeholder?.type === 'title')

    expect(title?.transform).toBeNull()
    expect(slide && title ? resolveTransform(deck, slide, title) : null).toMatchObject({
      x: 457200,
      y: 274638,
      width: 8229600,
      height: 1143000,
    })
  })

  it('gives the body the body geometry, not the title one', async () => {
    const deck = await deckOf('placeholders')
    const slide = deck.slides[0]
    const body = slide?.shapes.find((shape) => shape.placeholder?.index === 1)

    expect(slide && body ? resolveTransform(deck, slide, body) : null).toMatchObject({
      y: 1600200,
      height: 4525963,
    })
  })

  it('prefers what the shape itself states', async () => {
    const deck = await deckOf('shapes')
    const slide = deck.slides[0]
    const [rectangle] = slide?.shapes ?? []

    expect(slide && rectangle ? resolveTransform(deck, slide, rectangle) : null).toBe(
      rectangle?.transform,
    )
  })
})
