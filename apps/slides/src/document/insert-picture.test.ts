import { describe, expect, it } from 'vitest'
import { placement } from './insert-picture'

/**
 * Where a picture lands and how big.
 *
 * All of it from the file's header, which is why it can be asked here: the
 * proportions are in the first few dozen bytes and need no canvas.
 */

const SLIDE = { width: 12_192_000, height: 6_858_000 }

/** A PNG header claiming a size, which is all the placement reads. */
function png(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
  bytes.set([width >> 24, (width >> 16) & 255, (width >> 8) & 255, width & 255], 16)
  bytes.set([height >> 24, (height >> 16) & 255, (height >> 8) & 255, height & 255], 20)
  return bytes
}

describe('placing a picture', () => {
  it('keeps the proportions of a landscape photograph', () => {
    const box = placement(png(4000, 3000), SLIDE)
    expect(box.height / box.width).toBeCloseTo(3 / 4, 3)
  })

  it('keeps them for a portrait one too', () => {
    const box = placement(png(3000, 4000), SLIDE)
    expect(box.height / box.width).toBeCloseTo(4 / 3, 3)
  })

  it('takes a quarter of the slide across', () => {
    expect(placement(png(4000, 3000), SLIDE).width).toBe(SLIDE.width / 4)
  })

  it('fits a very tall picture to the slide rather than off it', () => {
    // A quarter of the width at 1:10 would be two and a half slides tall.
    const box = placement(png(400, 4000), SLIDE)
    expect(box.height).toBeLessThanOrEqual(SLIDE.height)
    expect(box.height / box.width).toBeCloseTo(10, 1)
  })

  it('centres it', () => {
    const box = placement(png(4000, 3000), SLIDE)
    expect(box.x + box.width / 2).toBeCloseTo(SLIDE.width / 2, 0)
    expect(box.y + box.height / 2).toBeCloseTo(SLIDE.height / 2, 0)
  })

  it('falls back to a square for a format it cannot measure', () => {
    // A guess at the shape of something unread would be wrong more often than
    // square is.
    const box = placement(new Uint8Array([1, 2, 3, 4]), SLIDE)
    expect(box.width).toBe(box.height)
  })
})
