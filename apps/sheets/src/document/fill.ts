import { putCell, shiftFormula } from '@orangery/ooxml-spreadsheet'
import type { Cell } from '@orangery/ooxml-spreadsheet'
import { applyEdit } from './edit'
import type { CellChange } from './edit'
import { filledWith, seriesOf } from './series'
import { shownText } from './shown'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * Dragging the corner of a selection.
 *
 * The grid says what was taken hold of and how far it went; what that means
 * is here. A line at a time — a column when the drag went down, a row when it
 * went across — because a series is a series along one axis, and three
 * columns dragged down are three series rather than one.
 *
 * A formula is copied rather than continued. A series of formulas is already
 * a formula with its references moved, which is what copying does, and
 * inventing a second rule for it would mean a cell that did something
 * different depending on whether somebody dragged or pasted it.
 *
 * The look goes with the value, as Excel does it: a dragged cell takes the
 * format of the cell it came from, or a column of dates filled downwards
 * would turn into a column of serial numbers.
 */

/** Where the handle was taken hold of, and where it was let go. */
export interface FillDrag {
  from: { top: number; bottom: number; left: number; right: number }
  to: { row: number; column: number }
}

export function fillCells(open: OpenWorkbook, sheet: OpenSheet, drag: FillDrag): CellChange[] {
  const { from, to } = drag

  const down = to.row > from.bottom || to.row < from.top
  const backwards = down ? to.row < from.top : to.column < from.left

  const count = down
    ? backwards
      ? from.top - to.row
      : to.row - from.bottom
    : backwards
      ? from.left - to.column
      : to.column - from.right
  if (count <= 0) return []

  const lines = down
    ? Array.from({ length: from.right - from.left + 1 }, (_, at) => from.left + at)
    : Array.from({ length: from.bottom - from.top + 1 }, (_, at) => from.top + at)

  const length = down ? from.bottom - from.top + 1 : from.right - from.left + 1
  const changes: CellChange[] = []

  for (const line of lines) {
    const source = Array.from({ length }, (_, at) => {
      const row = down ? from.top + at : line
      const column = down ? line : from.left + at
      return { row, column, cell: sheet.cells.rows.get(row)?.get(column) ?? null }
    })

    const texts = source.map((one) => shownText(open, one.cell))
    const values = filledWith(seriesOf(texts), texts, count, backwards)

    for (const [step, value] of values.entries()) {
      const offset = backwards ? -(step + 1) : length + step
      const row = down ? from.top + offset : line
      const column = down ? line : from.left + offset
      if (row < 0 || column < 0) continue

      // Which of the dragged cells this one is a copy of, counted so that a
      // block repeats in the order it was in rather than from its last cell.
      const at = ((offset % length) + length) % length
      const came = source[at]
      if (came === undefined) continue

      const before = sheet.cells.rows.get(row)?.get(column) ?? null

      if (came.cell?.formula != null) {
        const after: Cell = {
          ...came.cell,
          row,
          column,
          formula: {
            ...came.cell.formula,
            text: shiftFormula(came.cell.formula.text, {
              rows: row - came.row,
              columns: column - came.column,
            }),
          },
        }

        putCell(sheet.cells, after)
        changes.push({ sheet: sheet.path, row, column, before, after })
        continue
      }

      const change = applyEdit(open, sheet, { row, column }, value)
      if (change === null) continue

      // The format comes from the cell that was dragged. Without it a column
      // of dates filled downwards turns into a column of serial numbers.
      const style = came.cell?.style ?? null
      if (change.after !== null && change.after.style !== style) {
        const after = { ...change.after, style }
        putCell(sheet.cells, after)
        changes.push({ ...change, after })
        continue
      }

      changes.push(change)
    }
  }

  return changes
}
