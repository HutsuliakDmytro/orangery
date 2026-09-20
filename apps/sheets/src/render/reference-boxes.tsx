import { heightOfRow, offsetOfColumn, offsetOfRow, widthOfColumn } from '@orangery/grid'
import type { GridMetrics } from '@orangery/grid'
import { referencesIn } from '@orangery/ooxml-spreadsheet'
import { colorOfReference } from './reference-colors'

/**
 * The cells a formula names, boxed while it is being written.
 *
 * The oldest good idea in spreadsheets, and the one that makes a formula
 * readable at all: the colours in the text and the boxes on the sheet are the
 * same colours in the same order, so `=SUM(B2:B9)/C1` can be understood by
 * looking at the sheet rather than by decoding the text.
 *
 * Only while something is being written. A box round a cell that is not being
 * referred to right now is a box in the way.
 */

export interface ReferenceBoxesProps {
  /** The formula as it stands, half-typed and all. */
  text: string
  /** The sheet on screen, so a reference to another one is left undrawn. */
  sheet: string
  /** Already zoomed, as the grid hands them over. */
  metrics: GridMetrics
  scrollX: number
  scrollY: number
}

export function ReferenceBoxes({ text, sheet, metrics, scrollX, scrollY }: ReferenceBoxesProps) {
  if (!text.startsWith('=')) return null

  const found = referencesIn(text)

  return (
    <>
      {found.map((one, index) => {
        // A reference into another workbook has no cells here, and one naming
        // another sheet has cells that are not on screen.
        if (one.external || (one.sheet !== null && one.sheet !== sheet)) return null

        const top = Math.min(one.from.row, one.to.row)
        const bottom = Math.max(one.from.row, one.to.row)
        const left = Math.min(one.from.column, one.to.column)
        const right = Math.max(one.from.column, one.to.column)

        const x = metrics.headerWidth + offsetOfColumn(metrics, left) - scrollX
        const y = metrics.headerHeight + offsetOfRow(metrics, top) - scrollY
        const width =
          offsetOfColumn(metrics, right) -
          offsetOfColumn(metrics, left) +
          widthOfColumn(metrics, right)
        const height =
          offsetOfRow(metrics, bottom) - offsetOfRow(metrics, top) + heightOfRow(metrics, bottom)

        return (
          <div
            aria-hidden
            key={`${String(one.start)}:${String(one.end)}`}
            style={{
              position: 'absolute',
              left: x,
              top: y,
              width,
              height,
              border: `2px solid ${colorOfReference(index)}`,
              borderRadius: 2,
              // A box is a mark on the sheet, not a thing to click.
              pointerEvents: 'none',
              zIndex: 2,
            }}
          />
        )
      })}
    </>
  )
}
