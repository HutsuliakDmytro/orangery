import { indexToColumn } from '@orangery/ooxml-spreadsheet'
import type { Place } from '../document/formula'

/**
 * What an error in the cell under the cursor means.
 *
 * Excel puts this two clicks away, behind a small green triangle and a menu,
 * and most people never find it. The cost of showing it here is a strip that
 * appears only when the cursor is on a cell that is an error, and the gain is
 * that the commonest question anybody asks a spreadsheet — why does it say
 * this — is answered where they are already looking.
 *
 * The second sentence is the useful one. An error is contagious: one
 * `#DIV/0!` turns every sum that touches it into `#DIV/0!` as well, so a
 * screen of twenty wrong cells usually has one wrong cell in it. This says
 * which, and going there is one click.
 */

/** How tall it is, so whatever gives the grid its height can allow for it. */
export const STRIP_HEIGHT = 24

export interface ErrorStripProps {
  error: string
  explanation: string
  /** Where it began, when it began somewhere else. */
  blame: Place | null
  /** The sheet on screen, so a cell on another one is named with its sheet. */
  sheet: string
  onGo: (blame: Place) => void
}

export function ErrorStrip({ error, explanation, blame, sheet, onGo }: ErrorStripProps) {
  return (
    <div
      role="status"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        // A stated height rather than one the text decides: the grid is given
        // what is left of the window, and a strip that measured itself would
        // be a strip the grid found out about a frame late.
        height: STRIP_HEIGHT,
        boxSizing: 'border-box',
        padding: '0 10px',
        overflow: 'hidden',
        background: '#FFF4E5',
        borderBottom: '1px solid #E5D6C0',
        font: '12px -apple-system, system-ui, sans-serif',
        color: '#5A3E1B',
      }}
    >
      <strong style={{ fontFamily: 'ui-monospace, monospace' }}>{error}</strong>
      <span>{explanation}</span>

      {blame !== null && (
        <button
          type="button"
          onClick={() => {
            onGo(blame)
          }}
          style={{
            border: 'none',
            background: 'none',
            padding: 0,
            font: 'inherit',
            color: '#9A4B12',
            textDecoration: 'underline',
            cursor: 'pointer',
          }}
        >
          {`It started at ${named(blame, sheet)}`}
        </button>
      )}
    </div>
  )
}

/** `B7`, or `Notes!B7` when it is not the sheet somebody is looking at. */
const named = (place: Place, sheet: string): string => {
  const cell = `${indexToColumn(place.column)}${String(place.row + 1)}`
  return place.sheet === sheet ? cell : `${place.sheet}!${cell}`
}
