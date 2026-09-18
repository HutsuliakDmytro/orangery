import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { createDeck } from './create-deck'
import { readDeck } from './deck'
import type { Deck, Slide } from './deck'
import { applyFooters, NO_FOOTERS, readFooters } from './footers'
import { readPptxPackage } from './parts'
import { resolveTransform } from './placeholders'
import { saveDeck, writeSlidePart } from './save'
import { flatten } from './shape-tree'
import type { Shape } from './shape-tree'

/**
 * The date, the footer and the slide number as placeholders on a slide.
 *
 * Saving and reopening rather than reading the mutated model: what matters is
 * that the shape exists in the file, that it finds its geometry through the
 * layout, and that PowerPoint would see the same slide we do.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')
const DAY = new Date(2026, 8, 18)

const ON = { ...NO_FOOTERS, date: true, slideNumber: true, footer: true, footerText: 'Q3 review' }

/** Applies to the whole deck, writes every slide back, and reopens the package. */
async function apply(
  name: string,
  settings = ON,
  options: { skipTitleSlide?: boolean } = {},
): Promise<{ deck: Deck; changed: boolean }> {
  const pkg =
    name === 'new'
      ? await readPptxPackage(await createDeck())
      : await readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))
  const deck = readDeck(pkg)

  const changed = applyFooters(deck, deck.slides, settings, {
    ...options,
    now: DAY,
    locale: 'en-US',
  })
  for (const slide of deck.slides) writeSlidePart(pkg, slide)

  return { deck: readDeck(await readPptxPackage(await saveDeck(pkg))), changed }
}

const placeholder = (slide: Slide, type: string): Shape | undefined =>
  flatten(slide.shapes).find((shape) => shape.placeholder?.type === type)

const textIn = (slide: Slide, type: string): string => {
  const shape = placeholder(slide, type)
  return shape?.text == null ? '' : textOfBody(shape.text)
}

describe('turning footers on', () => {
  it('puts all three on every slide', async () => {
    const { deck, changed } = await apply('many-slides')

    expect(changed).toBe(true)
    for (const slide of deck.slides) {
      expect(placeholder(slide, 'dt')).toBeDefined()
      expect(placeholder(slide, 'ftr')).toBeDefined()
      expect(placeholder(slide, 'sldNum')).toBeDefined()
    }
  })

  it('numbers each slide with its own number', async () => {
    const { deck } = await apply('many-slides')

    const first = deck.slides[0]
    const third = deck.slides[2]
    if (first === undefined || third === undefined) throw new Error('fixture is too short')
    expect(textIn(first, 'sldNum')).toBe('1')
    expect(textIn(third, 'sldNum')).toBe('3')
  })

  it('writes the footer text it was given', async () => {
    const { deck } = await apply('many-slides')
    const first = deck.slides[0]
    if (first === undefined) throw new Error('fixture has no slides')

    expect(textIn(first, 'ftr')).toBe('Q3 review')
  })

  it('leaves the placeholder where the layout puts it', async () => {
    const { deck } = await apply('many-slides')
    const first = deck.slides[0]
    if (first === undefined) throw new Error('fixture has no slides')

    const number = placeholder(first, 'sldNum')
    if (number === undefined) throw new Error('no slide number placeholder')

    // Nothing of its own: position, size and font come from the layout, which
    // is what makes a deck built from six layouts put each footer in its place.
    expect(number.transform).toBeNull()
    expect(resolveTransform(deck, first, number)).not.toBeNull()
  })

  it('makes the shapes it adds distinguishable', async () => {
    const { deck } = await apply('many-slides')
    const first = deck.slides[0]
    if (first === undefined) throw new Error('fixture has no slides')

    // Two shapes sharing an id in one part is a file PowerPoint refuses, and
    // three placeholders added in one pass is exactly where that happens.
    const ids = flatten(first.shapes).map((shape) => shape.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('the date', () => {
  it('updates itself by default', async () => {
    const { deck } = await apply('many-slides')
    const first = deck.slides[0]
    if (first === undefined) throw new Error('fixture has no slides')

    expect(textIn(first, 'dt')).toBe('9/18/2026')
    expect(readFooters(first).fixedDate).toBeNull()
  })

  it('stays what it says when it is a fixed one', async () => {
    const { deck } = await apply('many-slides', { ...ON, fixedDate: '1 October 2026' })
    const first = deck.slides[0]
    if (first === undefined) throw new Error('fixture has no slides')

    expect(textIn(first, 'dt')).toBe('1 October 2026')
    // A run of text, not a field: there is no other way to say "this day and
    // not today".
    expect(readFooters(first).fixedDate).toBe('1 October 2026')
  })
})

describe('turning them off', () => {
  it('takes the shapes off the slide', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'many-slides.pptx')))
    const deck = readDeck(pkg)
    applyFooters(deck, deck.slides, ON, { now: DAY })
    for (const slide of deck.slides) writeSlidePart(pkg, slide)

    const again = readDeck(await readPptxPackage(await saveDeck(pkg)))
    applyFooters(again, again.slides, NO_FOOTERS, { now: DAY })
    for (const slide of again.slides) writeSlidePart(pkg, slide)

    const after = readDeck(await readPptxPackage(await saveDeck(pkg)))
    for (const slide of after.slides) {
      expect(placeholder(slide, 'ftr')).toBeUndefined()
      expect(placeholder(slide, 'sldNum')).toBeUndefined()
    }
  })

  it('changes nothing on a deck that never had them', async () => {
    const { changed } = await apply('many-slides', NO_FOOTERS)
    expect(changed).toBe(false)
  })
})

describe('the title slide', () => {
  it('is left alone when it is asked to be', async () => {
    const { deck } = await apply('new', ON, { skipTitleSlide: true })
    const first = deck.slides[0]
    if (first === undefined) throw new Error('a new deck has one slide')

    expect(placeholder(first, 'sldNum')).toBeUndefined()
  })

  it('gets them like any other when it is not', async () => {
    const { deck } = await apply('new', ON)
    const first = deck.slides[0]
    if (first === undefined) throw new Error('a new deck has one slide')

    expect(placeholder(first, 'sldNum')).toBeDefined()
  })
})

describe('reading what a slide shows', () => {
  it('finds nothing on a deck with no footers', async () => {
    const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'many-slides.pptx')))
    const first = readDeck(pkg).slides[0]
    if (first === undefined) throw new Error('fixture has no slides')

    expect(readFooters(first)).toEqual(NO_FOOTERS)
  })

  it('reads back what was applied', async () => {
    const { deck } = await apply('many-slides')
    const first = deck.slides[0]
    if (first === undefined) throw new Error('fixture has no slides')

    expect(readFooters(first)).toEqual({
      date: true,
      fixedDate: null,
      slideNumber: true,
      footer: true,
      footerText: 'Q3 review',
    })
  })
})
