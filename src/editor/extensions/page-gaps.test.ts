import { describe, expect, it } from 'vitest'
import { breakPositions, PAGE_GAP_PX } from './page-gaps'

/** One page is 600px tall in these cases, which keeps the arithmetic readable. */
const PAGE = 600

const block = (position: number, top: number, height: number) => ({ position, top, height })

describe('breakPositions', () => {
  it('finds no break in a document that fits on one page', () => {
    expect(breakPositions([block(0, 0, 100), block(1, 100, 200)], PAGE)).toEqual([])
  })

  it('breaks before the block that would cross the page edge', () => {
    const blocks = [block(0, 0, 500), block(1, 500, 200), block(2, 700, 100)]
    // The second block starts at 500 and ends at 700, past the 600 boundary.
    expect(breakPositions(blocks, PAGE)).toEqual([1])
  })

  it('does not break before the first block, however tall it is', () => {
    // Nothing can be moved off the first page, so a break there would be a gap
    // above the document.
    expect(breakPositions([block(0, 0, 5000)], PAGE)).toEqual([])
  })

  it('starts the next page at the moved block, not at the old boundary', () => {
    const blocks = [
      block(0, 0, 550),
      block(1, 550, 200), // moves to page 2, which now starts at 550
      block(2, 750, 300),
      block(3, 1050, 200), // 1050 + 200 > 550 + 600, so page 3
    ]
    expect(breakPositions(blocks, PAGE)).toEqual([1, 3])
  })

  it('handles a block taller than a page without looping', () => {
    const blocks = [block(0, 0, 100), block(1, 100, 2000), block(2, 2100, 100)]
    expect(() => breakPositions(blocks, PAGE)).not.toThrow()
    expect(breakPositions(blocks, PAGE)).toContain(1)
  })

  it('breaks once per page across a long document', () => {
    const blocks = Array.from({ length: 30 }, (_, index) => block(index, index * 100, 100))
    // 3000px of content at 600px per page is five pages, so four breaks.
    expect(breakPositions(blocks, PAGE)).toHaveLength(4)
  })

  it('returns nothing for an empty document', () => {
    expect(breakPositions([], PAGE)).toEqual([])
  })

  it('returns nothing rather than dividing by a zero page height', () => {
    expect(breakPositions([block(0, 0, 100)], 0)).toEqual([])
    expect(breakPositions([block(0, 0, 100)], -10)).toEqual([])
  })

  it('uses a desk band tall enough to read as a separation', () => {
    expect(PAGE_GAP_PX).toBeGreaterThanOrEqual(16)
  })
})

describe('breakPositions with a forced break', () => {
  const forced = (position: number, top: number, height: number) => ({
    position,
    top,
    height,
    forced: true,
  })

  it('breaks before a block that asks for a page, though the page has room', () => {
    const blocks = [block(0, 0, 100), forced(1, 100, 100), block(2, 200, 100)]
    expect(breakPositions(blocks, PAGE)).toEqual([1])
  })

  it('still does not break before the first block', () => {
    expect(breakPositions([forced(0, 0, 100), block(1, 100, 100)], PAGE)).toEqual([])
  })

  it('measures the next page from the forced break, not from the page above', () => {
    // Without the reset the third block would look like it sits at 900 on a
    // page that began at 0, and would gain a break it does not need.
    const blocks = [block(0, 0, 100), forced(1, 100, 100), block(2, 200, 500)]
    expect(breakPositions(blocks, PAGE)).toEqual([1])
  })

  it('breaks twice when a forced page is itself overrun', () => {
    const blocks = [block(0, 0, 100), forced(1, 100, 400), block(2, 500, 400)]
    expect(breakPositions(blocks, PAGE)).toEqual([1, 2])
  })
})

describe('breakPositions across sections', () => {
  const tall = (position: number, top: number, height: number, pageHeight: number) => ({
    position,
    top,
    height,
    pageHeight,
  })

  it('measures each block against the page of its own section', () => {
    // The second block sits on a shorter page, so it overruns where a block of
    // the same size on the first page would not.
    const blocks = [tall(0, 0, 400, PAGE), tall(1, 400, 300, 500)]
    expect(breakPositions(blocks, PAGE)).toEqual([1])
  })

  it('falls back to the document page for a block that states none', () => {
    expect(breakPositions([block(0, 0, 100), block(1, 100, 700)], PAGE)).toEqual([1])
  })
})
