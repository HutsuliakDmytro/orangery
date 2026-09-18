import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readDeck, readPptxPackage } from '@orangery/ooxml-presentation'
import { EMU_PER_INCH } from '@orangery/ooxml-drawingml'
import {
  estimatedSaving,
  mediaBytes,
  pictureUses,
  shrinkPlan,
  targetPixels,
  TARGET_PPI,
} from './media-plan'
import type { PictureUse } from './media-plan'
import { compressPictures } from './compress-media'

/**
 * Deciding what to shrink.
 *
 * All arithmetic, which is the point: the decision can be checked without a
 * canvas, and the cases worth checking are the ones nobody would think to
 * photograph.
 */

const FIXTURES = join(process.cwd(), 'tests/fixtures/pptx/synthetic')

const load = async (name: string) => readPptxPackage(await readFile(join(FIXTURES, `${name}.pptx`)))

/** A picture `pixels` wide, drawn `inches` across. */
function use(pixels: number, inches: number, bytes = 1_000_000): PictureUse {
  return {
    path: 'ppt/media/image1.png',
    bytes,
    size: { width: pixels, height: pixels },
    drawn: { width: inches * EMU_PER_INCH, height: inches * EMU_PER_INCH },
  }
}

describe('what a box needs', () => {
  it('is its size in inches times the resolution', () => {
    expect(targetPixels(4 * EMU_PER_INCH, 150)).toBe(600)
    expect(targetPixels(EMU_PER_INCH, 96)).toBe(96)
  })

  it('is never zero, however small the box', () => {
    expect(targetPixels(1, TARGET_PPI)).toBe(1)
  })
})

describe('the plan', () => {
  it('leaves a picture that is already the right size alone', () => {
    // 4 inches at 150 ppi is 600 pixels.
    expect(shrinkPlan([use(600, 4)])).toEqual([])
  })

  it('leaves one that is only slightly large alone, because the trade is bad', () => {
    expect(shrinkPlan([use(700, 4)])).toEqual([])
  })

  it('shrinks one carrying four times the pixels it shows', () => {
    const plan = shrinkPlan([use(2400, 4)])
    expect(plan).toHaveLength(1)
    expect(plan[0]?.to).toEqual({ width: 600, height: 600 })
  })

  it('keeps the picture’s own proportions, not the frame’s', () => {
    const plan = shrinkPlan([
      {
        path: 'ppt/media/image1.jpeg',
        bytes: 5_000_000,
        // A wide photograph in a square frame: the fill crops it, and squaring
        // the file would bake that crop in.
        size: { width: 4000, height: 1000 },
        drawn: { width: 4 * EMU_PER_INCH, height: 4 * EMU_PER_INCH },
      },
    ])

    expect(plan[0]?.to).toEqual({ width: 600, height: 150 })
  })

  it('says nothing about a format it could not measure', () => {
    expect(shrinkPlan([{ ...use(4000, 2), size: null }])).toEqual([])
  })

  it('says nothing about a picture that is drawn nowhere', () => {
    // Left in the package by an edit that removed the shape: there is no size
    // to aim at, and guessing one would blur a picture somebody may restore.
    expect(shrinkPlan([{ ...use(4000, 2), drawn: null }])).toEqual([])
  })
})

describe('the estimate', () => {
  it('falls with the pixel count', () => {
    const plan = shrinkPlan([use(1200, 4, 4_000_000)])
    // A quarter of the pixels, so about a quarter of the bytes kept.
    expect(Math.round(estimatedSaving(plan) / 1_000_000)).toBe(3)
  })

  it('is nothing when there is nothing to do', () => {
    expect(estimatedSaving([])).toBe(0)
  })
})

describe('against a real deck', () => {
  it('finds the picture and the size it is drawn at', async () => {
    const pkg = await load('picture')
    const uses = pictureUses(pkg, readDeck(pkg))

    expect(uses.length).toBeGreaterThan(0)
    expect(uses[0]?.path.startsWith('ppt/media/')).toBe(true)
    expect(uses[0]?.drawn).not.toBeNull()
    expect(uses[0]?.size).not.toBeNull()
  })

  it('counts the media a deck carries', async () => {
    const pkg = await load('picture')
    expect(mediaBytes(pkg)).toBeGreaterThan(0)
    expect(mediaBytes(await load('shapes'))).toBe(0)
  })
})

describe('applying a plan', () => {
  it('replaces the bytes in place, so nothing pointing at them has to know', async () => {
    const pkg = await load('picture')
    const uses = pictureUses(pkg, readDeck(pkg))
    const target = uses[0]
    if (target === undefined) throw new Error('fixture has no picture')

    const before = [...pkg.parts.keys()]
    const saved = await compressPictures(
      pkg,
      [
        {
          path: target.path,
          from: { width: 100, height: 100 },
          to: { width: 10, height: 10 },
          bytes: target.bytes,
        },
      ],
      () => Promise.resolve(new Uint8Array(8)),
    )

    expect(saved).toBe(target.bytes - 8)
    expect([...pkg.parts.keys()]).toEqual(before)
    expect(pkg.parts.get(target.path)?.bytes).toHaveLength(8)
  })

  it('puts a picture back when re-encoding made it bigger', async () => {
    const pkg = await load('picture')
    const uses = pictureUses(pkg, readDeck(pkg))
    const target = uses[0]
    if (target === undefined) throw new Error('fixture has no picture')

    const saved = await compressPictures(
      pkg,
      [
        {
          path: target.path,
          from: { width: 100, height: 100 },
          to: { width: 10, height: 10 },
          bytes: target.bytes,
        },
      ],
      () => Promise.resolve(new Uint8Array(target.bytes + 1)),
    )

    expect(saved).toBe(0)
    expect(pkg.parts.get(target.path)?.bytes).toHaveLength(target.bytes)
  })

  it('leaves a picture the engine would not decode exactly as it was', async () => {
    const pkg = await load('picture')
    const uses = pictureUses(pkg, readDeck(pkg))
    const target = uses[0]
    if (target === undefined) throw new Error('fixture has no picture')

    const saved = await compressPictures(
      pkg,
      [
        {
          path: target.path,
          from: { width: 100, height: 100 },
          to: { width: 10, height: 10 },
          bytes: target.bytes,
        },
      ],
      () => Promise.resolve(null),
    )

    expect(saved).toBe(0)
    expect(pkg.parts.get(target.path)?.bytes).toHaveLength(target.bytes)
  })
})
