import { insertPicture, UnsupportedPictureError } from '@orangery/ooxml-presentation'
import { imageSize } from '@orangery/ooxml-drawingml'
import { currentSlide, useDeckStore } from '../store/deck-store'

/** How much of the slide a picture takes when nobody has said otherwise. */
const SHARE = 0.25

/** How much of the slide one may fill before it is fitted rather than placed. */
const LIMIT = 0.8

/**
 * Where a picture goes and how big, from its own proportions.
 *
 * Square when the format is one this cannot measure — a guess at the shape of
 * something unread would be wrong more often than square is.
 */
export function placement(
  bytes: Uint8Array,
  slide: { width: number; height: number },
): { x: number; y: number; width: number; height: number } {
  const measured = imageSize(bytes)
  const ratio =
    measured === null || measured.width <= 0 || measured.height <= 0
      ? 1
      : measured.height / measured.width

  let width = slide.width * SHARE
  let height = width * ratio

  // A portrait photograph a quarter of the width can be twice the slide tall.
  const tallest = slide.height * LIMIT
  if (height > tallest) {
    height = tallest
    width = ratio === 0 ? width : height / ratio
  }

  return {
    x: Math.round((slide.width - width) / 2),
    y: Math.round((slide.height - height) / 2),
    width: Math.round(width),
    height: Math.round(height),
  }
}

/**
 * Putting a picture on the slide, wherever it came from.
 *
 * One place, because a picture chosen from a file dialog, pasted from the
 * clipboard and dropped onto the window are the same thing happening — and
 * three copies of "work out a sensible size and select it afterwards" would be
 * three chances for them to stop agreeing.
 *
 * Sized to a quarter of the slide's width, in the picture's own proportions,
 * and put in the middle. The proportions come from the file's header rather
 * than from decoding it — a photograph arriving as a square and being dragged
 * back into shape is a minute of work, and the aspect ratio is in the first few
 * dozen bytes.
 *
 * A picture too tall for the slide is fitted to the height instead, because a
 * portrait photograph a quarter of the width can easily be twice the slide.
 */
export function insertPictureOnSlide(fileName: string, bytes: Uint8Array): boolean {
  const { open, edit, selectShapes } = useDeckStore.getState()
  const slide = currentSlide(useDeckStore.getState())
  if (open === null || slide === null) return false

  const size = open.deck.slideSize
  const box = placement(bytes, size)
  const made: { id: number | null } = { id: null }

  edit((edited) => {
    try {
      made.id = insertPicture(open.package, edited, {
        fileName,
        bytes,
        transform: box,
      })
    } catch (cause) {
      // A format a deck cannot hold. Said out loud rather than swallowed: the
      // person just tried to put something on a slide and nothing happened.
      if (!(cause instanceof UnsupportedPictureError)) throw cause
      useDeckStore.setState({ error: cause.message })
      return false
    }
    return true
  })

  if (made.id !== null) selectShapes([made.id])
  return made.id !== null
}
