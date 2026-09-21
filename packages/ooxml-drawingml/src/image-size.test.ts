import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { readPackage } from '@orangery/ooxml-core'
import { imageSize } from './image-size'

/**
 * Measuring a picture without decoding it.
 *
 * The fixtures are real files rather than hand-built headers: a header this
 * agrees with itself about proves nothing, and every one of these formats has a
 * corner the specification allows and encoders actually use.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

async function mediaOf(deck: string): Promise<Uint8Array[]> {
  const pkg = await readPackage(await readFile(join(FIXTURES, `${deck}.pptx`)))
  return [...pkg.parts.values()]
    .filter((part) => part.path.startsWith('ppt/media/'))
    .map((part) => part.bytes)
}

describe('imageSize', () => {
  it('measures the pictures in a real deck', async () => {
    const media = await mediaOf('picture')
    const measured = media.map(imageSize)

    expect(measured.length).toBeGreaterThan(0)
    for (const size of measured) {
      expect(size).not.toBeNull()
      expect(size?.width).toBeGreaterThan(0)
      expect(size?.height).toBeGreaterThan(0)
    }
  })

  it('reads a PNG from its first chunk', () => {
    // An 8-byte signature, then a length, then `IHDR`, then the dimensions.
    const png = new Uint8Array(24)
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    png.set([0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52], 8)
    png.set([0, 0, 2, 0], 16)
    png.set([0, 0, 1, 0], 20)

    expect(imageSize(png)).toEqual({ width: 512, height: 256 })
  })

  it('walks past a JPEG comment to reach the frame', () => {
    const jpeg = new Uint8Array([
      0xff, 0xd8,
      // A comment segment eleven bytes long, which is not the frame.
      0xff, 0xfe, 0x00, 0x0b, 1, 2, 3, 4, 5, 6, 7, 8, 9,
      // SOF0: length, precision, height, width, and the rest.
      0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x90, 0x02, 0x80, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ])

    expect(imageSize(jpeg)).toEqual({ width: 640, height: 400 })
  })

  it('reads a GIF, which counts the other way round', () => {
    const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x20, 0x03, 0x58, 0x02])
    expect(imageSize(gif)).toEqual({ width: 800, height: 600 })
  })

  it('says nothing about a format it does not read', () => {
    expect(imageSize(new Uint8Array([0x42, 0x4d, 1, 2, 3, 4]))).toBeNull()
  })

  it('says nothing about a file too short to hold an answer', () => {
    expect(imageSize(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
  })
})
