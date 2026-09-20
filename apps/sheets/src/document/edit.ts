import { putCell, styleShowing } from '@orangery/ooxml-spreadsheet'
import type { Cell, CellType } from '@orangery/ooxml-spreadsheet'
import { parseInput } from '@orangery/numfmt'
import type { CellAddress } from '@orangery/grid'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * What typing into a cell does to the workbook.
 *
 * Two decisions and no more. What kind of thing was typed — which is
 * `numfmt`'s to answer, because it is the same question as formatting in
 * reverse — and, where the answer implies a format, which style entry shows
 * it. Everything else about the cell is left as it was: its font, its fill,
 * its borders, and the format it already had where typing implies none.
 *
 * That last part is what makes a formatted column usable. Typing `12` into a
 * cell showing currency leaves it currency; typing `15%` into the same cell
 * does not, because a percentage typed into a currency column is somebody
 * correcting the column rather than filling it in.
 */

/** A value written as text, the way a cell keeps it. */
function held(value: number | string | boolean): { type: CellType; value: string } {
  if (typeof value === 'number') return { type: 'n', value: String(value) }
  if (typeof value === 'boolean') return { type: 'b', value: value ? '1' : '0' }
  return { type: 'inlineStr', value }
}

/**
 * Puts what somebody typed into a cell.
 *
 * Written into the model in place: the workbook is a sparse map of a million
 * cells and the store hands the same one back, so a copy to change one string
 * would be a copy of all of it on every keystroke.
 */
export function applyEdit(
  open: OpenWorkbook,
  sheet: OpenSheet,
  address: CellAddress,
  text: string,
): void {
  const existing = sheet.cells.rows.get(address.row)?.get(address.column) ?? null
  const parsed = parseInput(text, { date1904: open.workbook.date1904 })

  // An empty cell is absent rather than blank: a `<c>` with no `<v>` is an
  // empty string to some readers and nothing to others, and absent is the one
  // form everybody agrees about.
  if (parsed.kind === 'text' && parsed.value === '') {
    sheet.cells.rows.get(address.row)?.delete(address.column)
    return
  }

  const { type, value } =
    parsed.kind === 'error'
      ? { type: 'e' as CellType, value: String(parsed.value) }
      : held(parsed.value)

  const style =
    parsed.format === null || open.styles === null
      ? (existing?.style ?? null)
      : styleShowing(open.styles, open.styleChanges, existing?.style ?? null, parsed.format)

  const cell: Cell = {
    row: address.row,
    column: address.column,
    type,
    value,
    style,
    // A typed value replaces whatever was computing the old one; keeping the
    // formula would leave the cell showing a number its own formula denies.
    formula: null,
    rich: null,
    carried: existing?.carried ?? null,
  }

  putCell(sheet.cells, cell)
}
