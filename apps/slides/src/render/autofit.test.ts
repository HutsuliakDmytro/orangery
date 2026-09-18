import { describe, expect, it } from 'vitest'
import { scaleFor, SCALES } from './autofit'

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
