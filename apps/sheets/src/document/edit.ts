import { putCell, styleShowing, styleWith } from '@orangery/ooxml-spreadsheet'
import type { Cell, CellType, LookChange } from '@orangery/ooxml-spreadsheet'
import { parseInput } from '@orangery/numfmt'
import type { CellAddress } from '@orangery/grid'
import { typedFormula } from './formula'
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
  const was = { sheet: sheet.path, row: address.row, column: address.column, before: existing }

  /**
   * A formula is not parsed here, and not worked out here.
   *
   * What it comes to is the engine's answer (`document/formula.ts`), and it
   * has not been asked yet when this returns: the cell is written with its
   * formula and no value, and the value arrives a moment later. Everything
   * about the cell that is not its value — its style, its format, the number
   * of decimals somebody chose — is left exactly as it was, because typing a
   * formula into a currency column is filling it in rather than restyling it.
   */
  const formula = typedFormula(text)
  if (formula !== null) {
    const cell: Cell = {
      row: address.row,
      column: address.column,
      type: 'n',
      value: null,
      style: existing?.style ?? null,
      formula: { text: formula, kind: 'normal', shared: null, ref: null },
      rich: null,
      carried: existing?.carried ?? null,
    }

    putCell(sheet.cells, cell)
    return { ...was, after: cell }
  }

  const parsed = parseInput(text, { date1904: open.workbook.date1904 })

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

  const styles = open.styles
  const formatted =
    parsed.format === null || styles === null
      ? (existing?.style ?? null)
      : styleShowing(styles, open.styleChanges, existing?.style ?? null, parsed.format)

  /**
   * A value with a line break in it is one that has to be shown on more than
   * one line.
   *
   * `Alt+Enter` puts the break in; wrapping is what makes it visible, and
   * Excel turns it on for exactly this reason. A cell left unwrapped would
   * show the first line and hide the rest, which looks like the break was lost.
   */
  const style =
    styles === null || typeof parsed.value !== 'string' || !parsed.value.includes('\n')
      ? formatted
      : styleWith(styles, open.styleChanges, formatted, { alignment: { wrapText: true } })

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
