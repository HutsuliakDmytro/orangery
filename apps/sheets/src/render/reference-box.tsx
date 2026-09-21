import { useState } from 'react'
import { formatReference, parseRange } from '@orangery/ooxml-spreadsheet'
import type { GridSelection } from '@orangery/grid'

/**
 * The box that says where you are, and takes you where you ask.
 *
 * It shows the active cell rather than the range, which is what Excel's does
 * and is the more useful of the two: the range is on screen in orange, and the
 * one thing the screen cannot tell you is which cell a typed value would land
 * in when four hundred are selected.
 *
 * Typing into it is navigation and nothing else. `B12` moves; `B2:D5` selects;
 * a name that means nothing is refused by putting the old text back, because
 * an address bar that silently keeps a wrong address is worse than one that
 * will not take it.
 */

export interface ReferenceBoxProps {
  selection: GridSelection
  /** Where the sheet reaches, so a reference past the end can be refused. */
  extent: { rows: number; columns: number }
  onGo: (selection: GridSelection) => void
}

export function ReferenceBox({ selection, extent, onGo }: ReferenceBoxProps) {
  const shown = formatReference(selection.active)
  const [text, setText] = useState(shown)
  const [followed, setFollowed] = useState(shown)

  /**
   * Follows the grid whenever the grid moves on its own — arrow keys, a click,
   * a jump to the edge of the data — while leaving half-typed text alone.
   *
   * Adjusted while rendering rather than in an effect. An effect would show
   * the old address for a frame and then correct it, which is a flicker on
   * every arrow key.
   */
  if (followed !== shown) {
    setFollowed(shown)
    setText(shown)
  }

  const go = () => {
    const wanted = selectionFrom(text, extent)
    if (wanted === null) {
      setText(shown)
      return
    }

    onGo(wanted)
  }

  return (
    <input
      aria-label="Name box"
      value={text}
      spellCheck={false}
      onChange={(event) => {
        setText(event.target.value)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault()
          go()
          event.currentTarget.blur()
        }
        if (event.key === 'Escape') {
          event.preventDefault()
          setText(shown)
          event.currentTarget.blur()
        }
      }}
      onBlur={go}
      className="h-6 w-32 shrink-0 rounded border border-border bg-surface px-2 text-xs text-text outline-none focus:border-accent"
    />
  )
}

/** What a typed reference selects, or null when it names nothing. */
function selectionFrom(
  text: string,
  extent: { rows: number; columns: number },
): GridSelection | null {
  const range = parseRange(text.trim())
  if (range === null) return null

  const inside = (cell: { row: number; column: number }) =>
    cell.row >= 0 && cell.row < extent.rows && cell.column >= 0 && cell.column < extent.columns
  if (!inside(range.from) || !inside(range.to)) return null

  // The anchor is the corner typed first, so `D5:B2` extends the way it was
  // written — which is what a range means and not what its bounds say.
  return {
    ranges: [{ anchor: range.from, focus: range.to }],
    active: range.from,
  }
}
