import { insertPicture, UnsupportedPictureError } from '@orangery/ooxml-presentation'
import { currentSlide, useDeckStore } from '../store/deck-store'

/**
 * Putting a picture on the slide, wherever it came from.
 *
 * One place, because a picture chosen from a file dialog, pasted from the
 * clipboard and dropped onto the window are the same thing happening — and
 * three copies of "work out a sensible size and select it afterwards" would be
 * three chances for them to stop agreeing.
 *
 * Sized to a quarter of the slide's width and put in the middle. The picture's
 * own proportions are not known here without decoding it, and a guess that is
 * wrong is worse than a square somebody drags into shape.
 */
export function insertPictureOnSlide(fileName: string, bytes: Uint8Array): boolean {
  const { open, edit, selectShapes } = useDeckStore.getState()
  const slide = currentSlide(useDeckStore.getState())
  if (open === null || slide === null) return false

  const size = open.deck.slideSize
  const side = size.width / 4
  const made: { id: number | null } = { id: null }

  edit((edited) => {
    try {
      made.id = insertPicture(open.package, edited, {
        fileName,
        bytes,
        transform: {
          x: (size.width - side) / 2,
          y: (size.height - side) / 2,
          width: side,
          height: side,
        },
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
