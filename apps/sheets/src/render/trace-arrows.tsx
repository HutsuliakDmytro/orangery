import { heightOfRow, offsetOfColumn, offsetOfRow, widthOfColumn } from '@orangery/grid'
import type { CellAddress, GridMetrics } from '@orangery/grid'
import type { Traced } from '../document/trace'

/**
 * The arrows that say where a number came from.
 *
 * Drawn over the canvas rather than into it, like the charts: they come and go
 * on a click and they must not make the grid repaint a million cells to
 * appear. An SVG layer that ignores the pointer, so a trace lying across a
 * column does not stop a click reaching the cell under it.
 *
 * One convention for every arrow, and it is Excel's: an arrow points from what
 * is read towards what reads it. So a precedent has an arrow *into* the cell
 * being traced, and a dependent has one *out of* it, and nobody has to
 * remember which colour means which direction.
 *
 * Red is the error's own trail, and only that. Everything else is blue,
 * because everything else is somebody asking an ordinary question about an
 * ordinary number.
 */

export interface TraceArrowsProps {
  traced: Traced
  /** The cell the trace is about, which every arrow has an end at. */
  cell: CellAddress
  /** The sheet on screen, so arrows to another one are left undrawn. */
  sheet: string
  /** Already zoomed, as the grid hands them over. */
  metrics: GridMetrics
  scrollX: number
  scrollY: number
}

const BLUE = '#1A63C7'
const RED = '#C7361A'

export function TraceArrows({ traced, cell, sheet, metrics, scrollX, scrollY }: TraceArrowsProps) {
  const at = (row: number, column: number) => ({
    x: metrics.headerWidth + offsetOfColumn(metrics, column) - scrollX,
    y: metrics.headerHeight + offsetOfRow(metrics, row) - scrollY,
    width: widthOfColumn(metrics, column),
    height: heightOfRow(metrics, row),
  })

  const middle = (row: number, column: number) => {
    const box = at(row, column)
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }

  const here = middle(cell.row, cell.column)

  // Only what is on this sheet. An arrow to a cell on another one would be an
  // arrow to somewhere on screen that is not where the cell is, which is
  // worse than no arrow: the strip above says how many there are instead.
  const precedents = traced.precedents.filter((one) => one.sheet === sheet)
  const dependents = traced.dependents.filter((one) => one.sheet === sheet)
  const blame = traced.blame !== null && traced.blame.sheet === sheet ? traced.blame : null

  return (
    <svg
      aria-hidden
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        // Over the charts: a trace is a thing somebody asked for a moment ago.
        zIndex: 2,
      }}
    >
      <defs>
        <marker id="trace-head" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill={BLUE} />
        </marker>
        <marker
          id="trace-head-error"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 z" fill={RED} />
        </marker>
      </defs>

      {precedents.map((one) => {
        const from = at(one.top, one.left)
        const to = at(one.bottom, one.right)
        const start = {
          x: from.x + (to.x + to.width - from.x) / 2,
          y: from.y + (to.y + to.height - from.y) / 2,
        }

        return (
          <g
            key={`p:${String(one.top)}:${String(one.left)}:${String(one.bottom)}:${String(one.right)}`}
          >
            <rect
              x={from.x + 1}
              y={from.y + 1}
              width={Math.max(to.x + to.width - from.x - 2, 2)}
              height={Math.max(to.y + to.height - from.y - 2, 2)}
              fill="none"
              stroke={BLUE}
              strokeWidth={1.5}
            />
            <line
              x1={start.x}
              y1={start.y}
              x2={here.x}
              y2={here.y}
              stroke={BLUE}
              strokeWidth={1.5}
              markerEnd="url(#trace-head)"
            />
          </g>
        )
      })}

      {dependents.map((one) => {
        const to = middle(one.row, one.column)

        return (
          <line
            key={`d:${String(one.row)}:${String(one.column)}`}
            x1={here.x}
            y1={here.y}
            x2={to.x}
            y2={to.y}
            stroke={BLUE}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            markerEnd="url(#trace-head)"
          />
        )
      })}

      {blame !== null && (
        <line
          x1={middle(blame.row, blame.column).x}
          y1={middle(blame.row, blame.column).y}
          x2={here.x}
          y2={here.y}
          stroke={RED}
          strokeWidth={2}
          markerEnd="url(#trace-head-error)"
        />
      )}
    </svg>
  )
}
