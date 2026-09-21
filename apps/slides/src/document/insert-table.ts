import { insertTable } from '@orangery/ooxml-presentation'
import { currentSlide, useDeckStore } from '../store/deck-store'

/**
 * Putting a table of a given size on the slide.
 *
 * Here rather than in the command, because the command now only opens the grid
 * that asks how big — and a function that both asks and does is one that cannot
 * be called by anything that already knows the answer.
 */
export function insertTableOnSlide(rows: number, columns: number): boolean {
  const { open, edit, selectShapes } = useDeckStore.getState()
  const slide = currentSlide(useDeckStore.getState())
  if (open === null || slide === null) return false

  const size = open.deck.slideSize

  // Across most of the slide and short enough to leave room above it, which is
  // where a table goes when nobody has said otherwise.
  const width = size.width * 0.8
  const height = Math.min(size.height * 0.12 * rows, size.height * 0.7)
  const made: { id: number | null } = { id: null }

  edit((edited) => {
    made.id = insertTable(open.package, edited, {
      rows,
      columns,
      transform: {
        x: (size.width - width) / 2,
        y: (size.height - height) / 2,
        width,
        height,
      },
    })
    return made.id !== null
  })

  if (made.id !== null) selectShapes([made.id])
  return made.id !== null
}
