import { describe, expect, it } from 'vitest'
import { boundsOf, snapRect } from './snap'
import type { Rect } from './snap'

/** Snapping a dragged shape to what is already on the slide. */

const SLIDE = { width: 9144000, height: 6858000 }
const NEAR = 60000

const rect = (x: number, y: number, width = 1000000, height = 1000000): Rect => ({
  x,
  y,
  width,
  height,
})

const run = (one: Rect, others: Rect[] = [], resizing = false) =>
  snapRect({ rect: one, others, slide: SLIDE, tolerance: NEAR, resizing })

describe('lining up with the slide', () => {
  it('takes a shape onto the middle', () => {
    const middle = SLIDE.width / 2 - 500000
    const { rect: snapped, guides } = run(rect(middle + 20000, 1000000))

    expect(snapped.x).toBe(middle)
    expect(guides.map((guide) => guide.at)).toContain(SLIDE.width / 2)
  })

  it('takes it onto an edge', () => {
    expect(run(rect(30000, 1000000)).rect.x).toBe(0)
    expect(run(rect(1000000, SLIDE.height - 1030000)).rect.y).toBe(SLIDE.height - 1000000)
  })

  it('leaves a shape that is nowhere near alone', () => {
    const loose = rect(2000000, 2000000)
    const { rect: snapped, guides } = run(loose)

    expect(snapped).toEqual(loose)
    expect(guides).toEqual([])
  })

  it('draws the line across the slide when it is the slide that matched', () => {
    const [guide] = run(rect(30000, 2000000)).guides

    expect(guide?.from).toBe(0)
    expect(guide?.to).toBe(SLIDE.height)
  })
})

describe('lining up with another shape', () => {
  it('matches a left edge', () => {
    const other = rect(3000000, 500000)
    expect(run(rect(3000000 + 40000, 2000000), [other]).rect.x).toBe(3000000)
  })

  it('matches a centre to a centre', () => {
    const other = rect(3000000, 500000, 2000000, 500000)
    // Centres at 4000000; the dragged shape is a million wide.
    const { rect: snapped } = run(rect(3450000, 2000000), [other])

    expect(snapped.x + snapped.width / 2).toBe(4000000)
  })

  it('matches one edge to the opposite one, which is how shapes sit side by side', () => {
    const other = rect(3000000, 2000000)
    expect(run(rect(4000000 + 25000, 2000000), [other]).rect.x).toBe(4000000)
  })

  it('draws the line only as far as the two shapes it is about', () => {
    const other = rect(3000000, 500000, 1000000, 400000)
    const [guide] = run(rect(3040000, 2000000), [other]).guides

    expect(guide?.from).toBe(500000)
    expect(guide?.to).toBe(3000000)
  })

  it('prefers the nearer of two matches', () => {
    const far = rect(3000000, 500000)
    const near = rect(3020000, 500000)

    expect(run(rect(3030000, 2000000), [far, near]).rect.x).toBe(3020000)
  })
})

describe('repeating a gap that is already there', () => {
  const first = rect(1000000, 2000000)
  const second = rect(3000000, 2000000)

  it('places a third at the same distance', () => {
    // The gap between the two is a million; the next one goes at 5000000.
    const { rect: snapped, guides } = run(rect(5030000, 2000000), [first, second])

    expect(snapped.x).toBe(5000000)
    expect(guides.map((guide) => guide.kind)).toContain('spacing')
  })

  it('places one on the other side too', () => {
    expect(run(rect(-1030000, 2000000), [first, second]).rect.x).toBe(-1000000)
  })

  it('marks the gap it matched, not the whole slide', () => {
    const [guide] = run(rect(5030000, 2000000), [first, second]).guides

    expect(guide?.from).toBe(4000000)
    expect(guide?.to).toBe(5000000)
  })

  it('ignores shapes that are not in the same row', () => {
    // Two boxes in a row are spaced evenly; a box off in the corner is not.
    const away = rect(3000000, 5000000)
    const { rect: snapped } = run(rect(5030000, 2000000), [first, away])

    expect(snapped.x).toBe(5030000)
  })

  it('gives way to an alignment, which is the stronger thing to say', () => {
    const aligned = rect(5000000 + 10000, 4000000)
    const { rect: snapped, guides } = run(rect(5030000, 2000000), [first, second, aligned])

    expect(snapped.x).toBe(5010000)
    expect(guides[0]?.kind).toBe('align')
  })
})

describe('resizing onto a line', () => {
  it('moves the edge that was dragged, not the whole shape', () => {
    const other = rect(3000000, 500000)
    const { rect: snapped } = run(rect(1000000, 2000000, 2040000, 1000000), [other], true)

    // The right edge was near the other shape's left; the left edge stays.
    expect(snapped.x).toBe(1000000)
    expect(snapped.x + snapped.width).toBe(3000000)
  })

  it('takes the difference off the size when the near edge is the start', () => {
    const other = rect(3000000, 500000)
    const { rect: snapped } = run(rect(3040000, 2000000, 1000000, 1000000), [other], true)

    expect(snapped.x).toBe(3000000)
    expect(snapped.width).toBe(1040000)
  })

  it('does not repeat gaps, which is a thing you do by moving', () => {
    const first = rect(1000000, 2000000)
    const second = rect(3000000, 2000000)
    const { guides } = run(rect(5030000, 2000000), [first, second], true)

    expect(guides.map((guide) => guide.kind)).not.toContain('spacing')
  })
})

describe('the rectangle around several', () => {
  it('covers them all', () => {
    expect(boundsOf([rect(1000000, 2000000), rect(3000000, 500000)])).toEqual({
      x: 1000000,
      y: 500000,
      width: 3000000,
      height: 2500000,
    })
  })

  it('is nothing for nothing', () => {
    expect(boundsOf([])).toBeNull()
  })
})
