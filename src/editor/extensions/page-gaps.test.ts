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
