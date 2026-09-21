import { offsetOfColumn, offsetOfRow, widthOfColumn } from '@orangery/grid'
import type { CellAddress, GridMetrics } from '@orangery/grid'
import type { CellNote } from './sheet-notes'

/**
 * A note, shown beside the cell it is about.
 *
 * Where Excel draws it is in a VML part — a drawing format from 2000 that
 * survives in `.xlsx` for exactly this — and that position is the one somebody
 * chose by dragging the box, years ago, on a screen of a different size. It is
 * not read yet (`PLAN.md`, phase 1.1), so the box goes where the cell is,
 * which is where Excel itself puts one that has never been moved.
 */

export interface NoteBoxProps {
  note: CellNote | null
  cell: CellAddress | null
  /** Already zoomed, as the grid hands them over. */
  metrics: GridMetrics
  scrollX: number
  scrollY: number
}

/** The widest a note is drawn, in points; Excel's own default is near this. */
const WIDTH = 200

export function NoteBox({ note, cell, metrics, scrollX, scrollY }: NoteBoxProps) {
  if (note === null || cell === null) return null

  // Off the cell's top-right corner, which is the corner the mark is in.
  const left =
    metrics.headerWidth +
    offsetOfColumn(metrics, cell.column) +
    widthOfColumn(metrics, cell.column) -
    scrollX +
    6
  const top = metrics.headerHeight + offsetOfRow(metrics, cell.row) - scrollY - 4

  return (
    <div
      role="note"
      aria-label={`Note on ${String(cell.row + 1)}`}
      style={{
        position: 'absolute',
        left,
        top,
        width: WIDTH,
        padding: '6px 8px',
        // The yellow every spreadsheet has used for this since before either
        // of the formats it is written in.
        background: '#FFFFE1',
        border: '1px solid #B2B2B2',
        boxShadow: '2px 2px 4px rgba(0, 0, 0, 0.2)',
        font: '12px -apple-system, system-ui, sans-serif',
        color: '#111111',
        whiteSpace: 'pre-wrap',
        // Over the charts, because a note is a thing somebody is reading now.
        zIndex: 1,
      }}
    >
      {note.said.map((said, index) => (
        <p key={`${String(index)}:${said.author}`} style={{ margin: index === 0 ? 0 : '6px 0 0' }}>
          {said.author === '' ? null : <strong style={{ display: 'block' }}>{said.author}</strong>}
          {said.text}
        </p>
      ))}

      {note.resolved && <p style={{ margin: '6px 0 0', color: '#666666' }}>Resolved</p>}
    </div>
  )
}
