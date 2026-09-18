import { EMU_PER_INCH, imageSize } from '@orangery/ooxml-drawingml'
import type { ImageSize } from '@orangery/ooxml-drawingml'
import { flatten, relationshipTarget } from '@orangery/ooxml-presentation'
import type { Deck, Shape, SlidePart } from '@orangery/ooxml-presentation'
import type { OoxmlPackage } from '@orangery/ooxml-core'

/**
 * Deciding what is worth shrinking, without touching a pixel.
 *
 * Everything here is arithmetic on headers and transforms, so it can be asked
 * in a test — where there is no canvas to decode an image with, and where the
 * interesting cases are the ones nobody would think to draw by hand.
 *
 * What it does not do is change the format. A PNG stays a PNG and a JPEG stays
 * a JPEG: converting between them means a new content type, a new part name and
 * a relationship to rewrite, and — for a PNG with transparency — a white box
 * where the transparency was. Scale alone accounts for nearly all of what a
 * photograph dropped onto a slide is carrying.
 */

/** When PowerPoint starts offering to compress, and so do we. */
export const MEDIA_LIMIT_BYTES = 20 * 1024 * 1024

/**
 * The resolution to shrink towards.
 *
 * PowerPoint's own "Print (220 ppi)" through "Email (96 ppi)"; 150 is the
 * middle one, and it is the one that still looks right on a projector, which is
 * what a deck is for.
 */
export const TARGET_PPI = 150

/**
 * How much larger than it is drawn a picture has to be before shrinking it is
 * worth the loss. Below this the saving is small and the damage is not.
 */
const WORTH_IT = 1.25

export interface PictureUse {
  /** The media part the picture lives in. */
  path: string
  bytes: number
  /** What the file says it is, or null for a format we cannot measure. */
  size: ImageSize | null
  /** The largest box it is drawn in anywhere in the deck, in EMU. */
  drawn: { width: number; height: number } | null
}

export interface Shrink {
  path: string
  to: ImageSize
  /** What it is now, for the saving that can be shown before anything is done. */
  from: ImageSize
  bytes: number
}

/** Every part under `ppt/media`, whether or not anything points at it. */
export function mediaBytes(pkg: OoxmlPackage): number {
  let total = 0
  for (const part of pkg.parts.values()) {
    if (part.path.startsWith('ppt/media/')) total += part.bytes.length
  }
  return total
}

/** Parts that hold a shape tree, which is where a picture can be drawn. */
function shapeParts(deck: Deck): SlidePart[] {
  return [...deck.slides, ...deck.layouts.values(), ...deck.masters.values()]
}

function drawnSize(shape: Shape): { width: number; height: number } | null {
  const transform = shape.transform
  if (transform === null) return null
  return { width: Math.abs(transform.width), height: Math.abs(transform.height) }
}

/**
 * Every picture in the deck, with the largest size it is drawn at.
 *
 * The largest, because one file can be on three slides and shrinking it to fit
 * the smallest would blur the other two. A picture drawn nowhere — left in the
 * package by an edit that removed the shape — has no size to aim at and is left
 * exactly as it is.
 */
export function pictureUses(pkg: OoxmlPackage, deck: Deck): PictureUse[] {
  const found = new Map<string, PictureUse>()

  for (const part of shapeParts(deck)) {
    for (const shape of flatten(part.shapes)) {
      const relationship = shape.picture?.relationshipId
      if (relationship == null) continue

      const target = relationshipTarget(pkg, part.path, relationship)
      const media = target === null ? undefined : pkg.parts.get(target)
      if (target === null || media === undefined) continue

      const drawn = drawnSize(shape)
      const existing = found.get(target)

      if (existing === undefined) {
        found.set(target, {
          path: target,
          bytes: media.bytes.length,
          size: imageSize(media.bytes),
          drawn,
        })
        continue
      }

      if (drawn === null) continue
      existing.drawn =
        existing.drawn === null
          ? drawn
          : {
              width: Math.max(existing.drawn.width, drawn.width),
              height: Math.max(existing.drawn.height, drawn.height),
            }
    }
  }

  return [...found.values()]
}

/** The pixels a box that many EMU wide needs at a given resolution. */
export function targetPixels(emu: number, ppi = TARGET_PPI): number {
  return Math.max(Math.round((emu / EMU_PER_INCH) * ppi), 1)
}

/**
 * Which pictures to shrink, and to what.
 *
 * A picture is only in the plan when it is meaningfully larger than the space
 * it occupies. Re-encoding one that is already the right size costs quality and
 * saves nothing, which is the worst trade available.
 */
export function shrinkPlan(uses: readonly PictureUse[], ppi = TARGET_PPI): Shrink[] {
  const plan: Shrink[] = []

  for (const use of uses) {
    if (use.size === null || use.drawn === null) continue

    const width = targetPixels(use.drawn.width, ppi)
    const height = targetPixels(use.drawn.height, ppi)
    if (use.size.width < width * WORTH_IT && use.size.height < height * WORTH_IT) continue

    // The picture's own proportions, not the box's: a photograph in a square
    // frame is cropped or letterboxed by the fill, and rewriting it to the
    // frame's shape would bake that in.
    const scale = Math.min(width / use.size.width, height / use.size.height, 1)
    plan.push({
      path: use.path,
      from: use.size,
      to: {
        width: Math.max(Math.round(use.size.width * scale), 1),
        height: Math.max(Math.round(use.size.height * scale), 1),
      },
      bytes: use.bytes,
    })
  }

  return plan
}

/**
 * A rough idea of what the plan would save, for the offer.
 *
 * Bytes scale with pixel count for a photograph, near enough to put a number in
 * a sentence — and the number is deliberately described as "about" wherever it
 * is shown, because for a flat-coloured PNG it is nonsense.
 */
export function estimatedSaving(plan: readonly Shrink[]): number {
  return plan.reduce((total, shrink) => {
    const ratio = (shrink.to.width * shrink.to.height) / (shrink.from.width * shrink.from.height)
    return total + shrink.bytes * (1 - ratio)
  }, 0)
}
