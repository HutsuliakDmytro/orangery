import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { children } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { applicable, applyChange, compareDecks, describeChange } from './compare'
import { readDeck } from './deck'
import type { Deck } from './deck'
import { removeSlide } from './add-slide'
import { deleteShapes } from './create-shape'
import { readPptxPackage } from './parts'
import { flatten } from './shape-tree'
import { setShapeText } from './write-text'
import { saveDeck, writeSlidePart } from './save'
import { moveShape } from './write-shape'

/**
 * What one deck has that another has not.
 *
 * Both sides are the same fixture, one of them edited — which is what a review
 * always is: somebody was sent a copy and sent it back different.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

async function load(name: string) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  return { pkg, deck: readDeck(pkg) }
}

/** A deck, read again after whatever was done to it was written back. */
async function reread(pkg: OoxmlPackage, deck: Deck): Promise<Deck> {
  for (const slide of deck.slides) writeSlidePart(pkg, slide)
  return readDeck(await readPptxPackage(await saveDeck(pkg)))
}

/**
 * The deck again, with one thing done to it and read back.
 *
 * Read back because a write goes into the XML and the parsed model beside it
 * is the reading the part was opened with — comparing against that would be
 * comparing two copies of the same reading.
 */
async function edited(change: (deck: Deck) => void, name = 'shapes'): Promise<Deck> {
  const { pkg, deck } = await load(name)
  change(deck)
  return reread(pkg, deck)
}

const firstShape = (deck: Deck) => {
  const shape = flatten(deck.slides[0]?.shapes ?? [])[0]
  if (shape === undefined) throw new Error('fixture has no shapes')
  return shape
}

const deckOf = async (name: string) => (await load(name)).deck

describe('nothing changed', () => {
  it('finds nothing between a deck and its own copy', async () => {
    expect(compareDecks(await deckOf('shapes'), await deckOf('shapes'))).toEqual([])
  })
})

/** The same deck with its first shape taken out of the tree, not just the model. */
const withoutFirstShape = () =>
  edited((deck) => {
    const slide = deck.slides[0]
    if (slide !== undefined) deleteShapes(slide, [firstShape(deck)])
  })

describe('what somebody did to a copy', () => {
  it('finds words that were rewritten', async () => {
    const theirs = await edited((deck) => {
      setShapeText(firstShape(deck), [{ text: 'Rewritten' }])
    })

    const changes = compareDecks(await deckOf('shapes'), theirs)
    expect(changes).toHaveLength(1)
    expect(changes[0]).toMatchObject({ kind: 'text', from: 'Rectangle', to: 'Rewritten' })
  })

  it('finds a shape that was moved', async () => {
    const theirs = await edited((deck) => {
      moveShape(firstShape(deck), { x: 900_000, y: 0 })
    })

    expect(compareDecks(await deckOf('shapes'), theirs)[0]).toMatchObject({ kind: 'moved' })
  })

  it('finds a shape that is gone', async () => {
    const theirs = await withoutFirstShape()

    expect(compareDecks(await deckOf('shapes'), theirs)[0]).toMatchObject({
      kind: 'shape-removed',
      name: 'Rectangle 1',
    })
  })

  it('finds a slide that is gone, and says so without offering to take it', async () => {
    const mine = await deckOf('many-slides')
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'many-slides.pptx')))
    removeSlide(pkg, 0)
    const theirs = readDeck(pkg)

    const changes = compareDecks(mine, theirs)
    const slideChange = changes.find((one) => one.kind === 'slide-removed')

    expect(slideChange).toBeDefined()
    // Bringing a whole slide across means bringing its layout, its pictures
    // and the relationships naming them: its own piece of work.
    expect(slideChange === undefined ? true : applicable(slideChange)).toBe(false)
  })
})

describe('taking a change', () => {
  /** Takes every change the other deck offers, and reads this one back. */
  async function taking(theirs: Deck) {
    const { pkg, deck } = await load('shapes')
    for (const change of compareDecks(deck, theirs)) applyChange(deck, theirs, change)

    return reread(pkg, deck)
  }

  it('takes the words, and the formatting they came with', async () => {
    const theirs = await edited((deck) => {
      setShapeText(firstShape(deck), [{ text: 'Rewritten' }])
    })

    const mine = await taking(theirs)
    const body = firstShape(mine).text

    expect(body === null ? '' : textOfBody(body)).toBe('Rewritten')
    expect(compareDecks(mine, theirs)).toEqual([])
  })

  it('takes a move', async () => {
    const theirs = await edited((deck) => {
      moveShape(firstShape(deck), { x: 900_000, y: 0 })
    })

    expect(compareDecks(await taking(theirs), theirs)).toEqual([])
  })

  it('takes a shape that was added, with everything on it', async () => {
    // Their deck is the one missing a shape, so comparing the other way round
    // is the case where one arrives.
    const shorter = await withoutFirstShape()
    const mine = await deckOf('shapes')

    const change = compareDecks(shorter, mine)[0]
    if (change === undefined) throw new Error('nothing to take')
    expect(change.kind).toBe('shape-added')

    const before = children(shorter.slides[0]?.tree ?? {}).length
    expect(applyChange(shorter, mine, change)).toBe(true)
    expect(children(shorter.slides[0]?.tree ?? {}).length).toBe(before + 1)
  })

  it('refuses a change about a whole slide', async () => {
    const mine = await deckOf('many-slides')
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'many-slides.pptx')))
    removeSlide(pkg, 0)
    const theirs = readDeck(pkg)

    const change = compareDecks(mine, theirs).find((one) => one.kind === 'slide-removed')
    expect(change === undefined ? null : applyChange(mine, theirs, change)).toBe(false)
  })
})

describe('saying what changed', () => {
  it('reads as a person would say it', () => {
    expect(
      describeChange({
        kind: 'text',
        slide: 1,
        shapeId: 2,
        name: 'Title',
        from: 'Before',
        to: 'After',
      }),
    ).toContain('Title')
  })
})
