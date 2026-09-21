import { contentTypeOf } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { contentTypeFor } from '@orangery/ooxml-drawingml'
import type { ImageSize } from '@orangery/ooxml-drawingml'
import type { Shrink } from './media-plan'

/**
 * Making the pictures smaller.
 *
 * The decision is elsewhere and is arithmetic; this is the part that needs a
 * browser, because the only image decoder we have is the one drawing the app.
 * It is handed in rather than reached for, so the rest can be tested without
 * one — jsdom has no canvas, and a test that cannot run is not a test.
 */

/** Re-encodes `bytes` at `to`, or returns null if it cannot. */
export type Resize = (bytes: Uint8Array, type: string, to: ImageSize) => Promise<Uint8Array | null>

/** Quality for the formats that have one. PowerPoint's own is around here. */
const JPEG_QUALITY = 0.8

export const resizeWithCanvas: Resize = async (bytes, type, to) => {
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null

  // A copy into a plain ArrayBuffer: the bytes may be a view onto the zip's own
  // buffer, and Blob would take the whole of it.
  const blob = new Blob([bytes.slice().buffer], { type })

  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(blob)
  } catch {
    // A format the engine will not decode. Saying so is the whole response:
    // the picture is then left exactly as it was.
    return null
  }

  try {
    const canvas = document.createElement('canvas')
    canvas.width = to.width
    canvas.height = to.height

    const context = canvas.getContext('2d')
    if (context === null) return null
    context.drawImage(bitmap, 0, 0, to.width, to.height)

    const encoded = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, JPEG_QUALITY)
    })
    if (encoded === null) return null

    return new Uint8Array(await encoded.arrayBuffer())
  } finally {
    bitmap.close()
  }
}

/**
 * Applies a plan to the package, and answers with what it actually saved.
 *
 * A picture that came back larger is put back as it was. That is not a rare
 * case: a screenshot of flat colour re-encoded as PNG at 70% of its width can
 * easily grow, and a "compress" that made the file bigger would be a lie told
 * in the one place a person was trusting us with their work.
 */
export async function compressPictures(
  pkg: OoxmlPackage,
  plan: readonly Shrink[],
  resize: Resize = resizeWithCanvas,
): Promise<number> {
  let saved = 0

  for (const shrink of plan) {
    const part = pkg.parts.get(shrink.path)
    if (part === undefined) continue

    const type = contentTypeOf(pkg, shrink.path) ?? contentTypeFor(shrink.path)
    if (type === null) continue

    const smaller = await resize(part.bytes, type, shrink.to)
    if (smaller === null || smaller.length >= part.bytes.length) continue

    saved += part.bytes.length - smaller.length
    // The part is replaced, not the relationship: the same file in the same
    // place with fewer bytes in it, so nothing that points at it has to know.
    pkg.parts.set(shrink.path, { ...part, bytes: smaller })
  }

  return saved
}
