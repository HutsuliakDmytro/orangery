import { describe, expect, it } from 'vitest'
import { EMU_PER_PIXEL } from '@orangery/ooxml-drawingml'
import { heightForText, scaleFor, SCALES } from './autofit'

/**
 * Deciding how far text has to shrink.
 *
 * The property worth testing is not any single answer but that the answers
 * settle: the same measurement asked twice must give the same scale, or the
 * slide would redraw for as long as anybody looked at it.
 */

const FULL = 100000

describe('text that does not fit', () => {
  it('shrinks by about as much as it overflows', () => {
    // A fifth too tall wants roughly four fifths the size.
    expect(scaleFor(FULL, { content: 120, box: 100 })).toBe(77500)
  })

  it('lands on a scale the format is written with', () => {
    for (const content of [101, 130, 175, 260, 400, 800]) {
      expect(SCALES).toContain(scaleFor(FULL, { content, box: 100 }))
    }
  })

  it('stops at the smallest the format goes to', () => {
    // Beyond a quarter there is no answer, and unreadable text in the box is
    // not better than readable text out of it.
    expect(scaleFor(FULL, { content: 10000, box: 100 })).toBe(25000)
  })

  it('shrinks again from a scale that is already small', () => {
    expect(scaleFor(50000, { content: 200, box: 100 })).toBe(25000)
  })
})

describe('text with room to spare', () => {
  it('grows back when the words are taken away', () => {
    // Half the box at half the size: it would fit whole.
    expect(scaleFor(50000, { content: 40, box: 100 })).toBe(100000)
  })

  it('does not grow when it only just fits', () => {
    expect(scaleFor(70000, { content: 99, box: 100 })).toBe(70000)
  })

  it('never grows past full size', () => {
    expect(scaleFor(FULL, { content: 1, box: 100 })).toBe(FULL)
  })
})

describe('settling', () => {
  /** What the content would measure at a new scale, if height were linear. */
  const measured = (content: number, from: number, to: number) => (content * to) / from

  it('gives the same answer twice for text that overflows', () => {
    const first = scaleFor(FULL, { content: 150, box: 100 })
    const again = scaleFor(first, { content: measured(150, FULL, first), box: 100 })

    // Otherwise every render would disagree with the one before it.
    expect(again).toBe(first)
  })

  it('gives the same answer twice for text that has room', () => {
    const first = scaleFor(40000, { content: 30, box: 100 })
    const again = scaleFor(first, { content: measured(30, 40000, first), box: 100 })

    expect(again).toBe(first)
  })

  it('settles from anywhere on the ladder', () => {
    for (const start of SCALES) {
      for (const content of [20, 60, 99, 100, 140, 300]) {
        const first = scaleFor(start, { content, box: 100 })
        const again = scaleFor(first, { content: measured(content, start, first), box: 100 })
        expect(again, `${String(start)} at ${String(content)}`).toBe(first)
      }
    }
  })
})

describe('nothing to measure', () => {
  it('leaves the scale alone rather than inventing one', () => {
    // A shape that has not been laid out yet, or one with no height at all.
    expect(scaleFor(70000, { content: 0, box: 100 })).toBe(70000)
    expect(scaleFor(70000, { content: 50, box: 0 })).toBe(70000)
  })
})

/**
 * The height a shape gives its words, and the loop it used to be.
 *
 * A shape that asks to fit its text is measured after layout and resized from
 * the measurement. The first version worked the height out from
 * `outer.clientHeight - inner.clientHeight`, where `outer` is the shape — so
 * the shape's own height was an input to the height it was about to be given.
 * Measure, resize, measure again: on one real deck that never settled, and a
 * layout effect that writes to the store on every pass is React's "maximum
 * update depth exceeded". The window came down and the deck could not be
 * opened at all.
 *
 * The fix is the property asserted here: the answer depends on the words and
 * on what the file says the shape keeps around them, and on nothing else.
 */
describe('the height a shape needs for its words', () => {
  it('is the words plus the insets the file states', () => {
    // 100 px of text, and an inset of a tenth of an inch top and bottom.
    expect(heightForText(100, { top: 91440, bottom: 91440 })).toBe(
      Math.round(100 * EMU_PER_PIXEL) + 182880,
    )
  })

  it('falls back to what PowerPoint keeps when the shape says nothing', () => {
    expect(heightForText(100, null)).toBe(Math.round(100 * EMU_PER_PIXEL) + 45720 + 45720)
    expect(heightForText(100, { top: null, bottom: null })).toBe(heightForText(100, null))
  })

  it('does not depend on the height of the shape, which is what made it loop', () => {
    // The same words in a box of any height want the same box back. This is
    // the whole property: a function of the thing it sets cannot settle.
    const wanted = heightForText(240, { top: 45720, bottom: 45720 })

    expect(heightForText(240, { top: 45720, bottom: 45720 })).toBe(wanted)
  })

  it('settles: asking again with the answer it gave returns the same answer', () => {
    const insets = { top: 45720, bottom: 45720 }
    const once = heightForText(180, insets)
    const twice = heightForText(180, insets)

    expect(twice).toBe(once)
  })

  it('grows with the words and with nothing else', () => {
    const insets = { top: 0, bottom: 0 }

    expect(heightForText(200, insets) - heightForText(100, insets)).toBe(
      Math.round(200 * EMU_PER_PIXEL) - Math.round(100 * EMU_PER_PIXEL),
    )
  })
})
