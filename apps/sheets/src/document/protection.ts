import { resolveStyle } from '@orangery/ooxml-spreadsheet'
import type { CellAddress } from '@orangery/grid'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * Whether a cell may be changed.
 *
 * Protection is not security. The password on a protected sheet is a hash
 * anybody can strip, and Microsoft has never claimed otherwise: it is there
 * to stop somebody typing over a formula by accident, which is a real thing
 * to want and a different thing from keeping a secret.
 *
 * Which is why this is honoured rather than enforced, and why the hash is
 * carried through a save untouched. Rewriting it would be claiming to have
 * checked it.
 *
 * Every cell is locked unless its style says otherwise — that is the default
 * in the file, and it is the reason protecting a sheet locks everything
 * rather than nothing. A sheet that is not protected has no locked cells at
 * all, however many of them say they are.
 */

export function isLocked(open: OpenWorkbook, sheet: OpenSheet, cell: CellAddress): boolean {
  if (sheet.sheet.protection?.cells !== true) return false

  const styles = open.styles
  if (styles === null) return true

  const held = sheet.cells.rows.get(cell.row)?.get(cell.column) ?? null
  return resolveStyle(styles, held?.style ?? null).locked
}

/** What to say to somebody who tried, or null when they may. */
export function refusalForLocked(
  open: OpenWorkbook,
  sheet: OpenSheet,
  cells: Iterable<CellAddress>,
): string | null {
  if (sheet.sheet.protection?.cells !== true) return null

  for (const cell of cells) {
    if (isLocked(open, sheet, cell)) {
      return 'This sheet is protected. Unprotect it in Excel to change this cell.'
    }
  }

  return null
}
