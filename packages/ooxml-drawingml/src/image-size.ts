/**
 * How many pixels an image actually has.
 *
 * Read from the file's own header rather than by decoding it: the answer is in
 * the first few dozen bytes of every format we care about, and decoding a
 * forty-megapixel photograph to learn its width is a great deal of work for two
 * numbers. It also means this can be asked in a test, where there is no canvas
 * to decode with.
 */

export interface ImageSize {
  width: number
  height: number
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((byte, index) => bytes[index] === byte)
}

function beUint32(bytes: Uint8Array, at: number): number {
  return (
    ((bytes[at] ?? 0) << 24) |
    ((bytes[at + 1] ?? 0) << 16) |
    ((bytes[at + 2] ?? 0) << 8) |
    (bytes[at + 3] ?? 0)
  )
}

function beUint16(bytes: Uint8Array, at: number): number {
  return ((bytes[at] ?? 0) << 8) | (bytes[at + 1] ?? 0)
}

function pngSize(bytes: Uint8Array): ImageSize | null {
  // `IHDR` is required to be the first chunk, so the dimensions are always here.
  if (bytes.length < 24) return null
  return { width: beUint32(bytes, 16) >>> 0, height: beUint32(bytes, 20) >>> 0 }
}

/**
 * JPEG keeps its dimensions in a start-of-frame marker, which sits after an
 * unknown number of other segments — so the segments are walked rather than
 * counted. Which flavour of frame it is (baseline, progressive, arithmetic)
 * does not change where the numbers are.
 */
function jpegSize(bytes: Uint8Array): ImageSize | null {
  let at = 2

  while (at + 9 < bytes.length) {
    if (bytes[at] !== 0xff) {
      at += 1
      continue
    }

    const marker = bytes[at + 1] ?? 0

    // Padding and the standalone markers carry no length to skip by.
    if (marker === 0xff || (marker >= 0xd0 && marker <= 0xd9)) {
      at += 2
      continue
    }

    // SOF0…SOF15, except the four that are not frames at all.
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: beUint16(bytes, at + 5), width: beUint16(bytes, at + 7) }
    }

    const length = beUint16(bytes, at + 2)
    if (length < 2) return null
    at += 2 + length
  }

  return null
}

function gifSize(bytes: Uint8Array): ImageSize | null {
  if (bytes.length < 10) return null
  // Little-endian, unlike everything else here.
  return {
    width: (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8),
    height: (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8),
  }
}

/** The pixel size of an image, or null for a format this does not read. */
export function imageSize(bytes: Uint8Array): ImageSize | null {
  if (startsWith(bytes, PNG_SIGNATURE)) return pngSize(bytes)
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegSize(bytes)
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) return gifSize(bytes)
  return null
}
