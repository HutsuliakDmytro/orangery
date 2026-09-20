import { putCell, styleShowing, styleWith } from '@orangery/ooxml-spreadsheet'
import type { Cell, CellType, LookChange } from '@orangery/ooxml-spreadsheet'
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
 * What one cell was, and what it became.
 *
 * Both halves, because undo needs the first and redo needs the second, and a
 * history that kept only one of them would be a history that could go in one
 * direction.
 */
export interface CellChange {
  /** The part, rather than the position: sheets can be reordered. */
  sheet: string
  row: number
  column: number
  before: Cell | null
  after: Cell | null
}

/**
 * Puts what somebody typed into a cell, and says what that changed.
 *
 * Written into the model in place: the workbook is a sparse map of a million
 * cells and the store hands the same one back, so a copy to change one string
 * would be a copy of all of it on every keystroke.
 *
 * Null when nothing changed — typing the same thing again, or emptying a cell
 * that was already empty. A step that changed nothing is a step that undo
 * would appear to skip.
 */
export function applyEdit(
  open: OpenWorkbook,
  sheet: OpenSheet,
  address: CellAddress,
  text: string,
): CellChange | null {
  const existing = sheet.cells.rows.get(address.row)?.get(address.column) ?? null
  const parsed = parseInput(text, { date1904: open.workbook.date1904 })
  const was = { sheet: sheet.path, row: address.row, column: address.column, before: existing }

  // An empty cell is absent rather than blank: a `<c>` with no `<v>` is an
  // empty string to some readers and nothing to others, and absent is the one
  // form everybody agrees about.
  if (parsed.kind === 'text' && parsed.value === '') {
    if (existing === null) return null

    sheet.cells.rows.get(address.row)?.delete(address.column)
    return { ...was, after: null }
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
  return { ...was, after: cell }
}

/**
 * Empties every cell of a range, as one change apiece.
 *
 * Handed back rather than applied step by step: clearing a selection is one
 * thing somebody did and has to be one thing they can take back.
 */
export function clearCells(sheet: OpenSheet, cells: Iterable<CellAddress>): CellChange[] {
  const changes: CellChange[] = []

  for (const address of cells) {
    const existing = sheet.cells.rows.get(address.row)?.get(address.column) ?? null
    if (existing === null) continue

    sheet.cells.rows.get(address.row)?.delete(address.column)
    changes.push({
      sheet: sheet.path,
      row: address.row,
      column: address.column,
      before: existing,
      after: null,
    })
  }

  return changes
}

/**
 * Changes how the given cells look, and says what that changed.
 *
 * A cell that does not exist yet is made, empty. Formatting is one of the few
 * things a spreadsheet lets you do to nothing: choosing a column and making it
 * a date column before typing a single date into it is the ordinary way round,
 * and a cell with a style and no value is exactly what the file writes for it.
 */
export function applyLook(
  open: OpenWorkbook,
  sheet: OpenSheet,
  cells: Iterable<CellAddress>,
  look: LookChange,
): CellChange[] {
  const styles = open.styles
  if (styles === null) return []

  const changes: CellChange[] = []

  for (const address of cells) {
    const existing = sheet.cells.rows.get(address.row)?.get(address.column) ?? null
    const style = styleWith(styles, open.styleChanges, existing?.style ?? null, look)
    if (existing !== null && existing.style === style) continue

    const cell: Cell =
      existing === null
        ? {
            row: address.row,
            column: address.column,
            type: 'n',
            value: null,
            style,
            formula: null,
            rich: null,
            carried: null,
          }
        : { ...existing, style }

    putCell(sheet.cells, cell)
    changes.push({
      sheet: sheet.path,
      row: address.row,
      column: address.column,
      before: existing,
      after: cell,
    })
  }

  return changes
}

/** Puts a cell back the way a change found it, or takes it away again. */
export function restore(sheet: OpenSheet, change: CellChange, to: 'before' | 'after'): void {
  const cell = change[to]

  if (cell === null) sheet.cells.rows.get(change.row)?.delete(change.column)
  else putCell(sheet.cells, cell)
}
