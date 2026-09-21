import { applyShapeFormat, copyShapeFormat, flatten } from '@orangery/ooxml-presentation'
import type { ShapeFormat } from '@orangery/ooxml-presentation'
import { useDeckStore } from '../store/deck-store'

/**
 * The format painter, as two halves of one gesture.
 *
 * PowerPoint makes it an armed button you then click a shape with. Two named
 * commands do the same work and are reachable from the keyboard, the menu and
 * the palette — and this app already has one armed pointer, for drawing, which
 * is one mode to get stuck in more than enough.
 *
 * What is held lives here rather than in a store because nothing draws it: the
 * toolbar asks whether there is something to paste, and that is all.
 */

let held: ShapeFormat | null = null

export function heldFormat(): ShapeFormat | null {
  return held
}

export function clearFormat(): void {
  held = null
}

/** The shapes picked out on the slide showing, groups walked into. */
function selectedShapes() {
  const { open, current, selection } = useDeckStore.getState()
  const slide = open?.deck.slides[current]
  if (slide === undefined) return []

  return flatten(slide.shapes).filter((shape) => selection.includes(shape.id))
}

/** Picks up the look of the first shape picked out. Returns whether it could. */
export function copyFormatting(): boolean {
  // The first and not all of them: a brush holds one look, and asking which of
  // three selected shapes it should be is a question with no good answer.
  const shape = selectedShapes()[0]
  if (shape === undefined) return false

  held = copyShapeFormat(shape)
  return held !== null
}

export function pasteFormatting(): void {
  const format = held
  if (format === null) return

  useDeckStore.getState().edit((slide) => {
    const ids = new Set(selectedShapes().map((shape) => shape.id))

    // Re-found on the part being edited rather than reusing the shapes read
    // above: `edit` hands over the slide it is about to write, and painting
    // onto anything else would be painting onto a copy.
    return flatten(slide.shapes)
      .filter((shape) => ids.has(shape.id))
      .map((shape) => applyShapeFormat(shape, format))
      .some(Boolean)
  })
}
