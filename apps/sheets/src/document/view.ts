import { getPartText, setPartText } from '@orangery/ooxml-core'
import { changeView } from '@orangery/ooxml-spreadsheet'
import type { FrozenPanes, ViewChange } from '@orangery/ooxml-spreadsheet'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * How a sheet is looked at: what is held still, how big it is drawn, whether
 * the gridlines are there.
 *
 * Written into the part as it is changed rather than collected for the save,
 * which is what the tab colour does too. A view is not a cell and has no
 * business in the history — nobody expects undo to take back a zoom — so
 * there is nothing to collect, and patching the part immediately keeps the
 * model and the bytes saying the same thing.
 *
 * The zoom is not in the history for the same reason Excel does not put it
 * there: it is how somebody is looking at the sheet, not what the sheet says.
 */

function applied(open: OpenWorkbook, sheet: OpenSheet, change: ViewChange): boolean {
  const xml = getPartText(open.pkg, sheet.path)
  if (xml === undefined) return false

  setPartText(open.pkg, sheet.path, changeView(xml, change))
  return true
}

/**
 * Everything above and to the left of a cell, held still.
 *
 * At the cursor, as Excel does it: the cell somebody is on is the first one
 * that moves. A cursor in the top-left corner freezes nothing, which is how
 * the same command unfreezes.
 */
export function freezeAt(
  open: OpenWorkbook,
  sheet: OpenSheet,
  at: { row: number; column: number },
): boolean {
  const panes: FrozenPanes | null =
    at.row === 0 && at.column === 0 ? null : { rows: at.row, columns: at.column, split: false }

  if (!applied(open, sheet, { panes })) return false

  sheet.sheet = { ...sheet.sheet, view: { ...sheet.sheet.view, panes } }
  return true
}

/** The freeze taken off, whatever it was. */
export function unfreeze(open: OpenWorkbook, sheet: OpenSheet): boolean {
  if (!applied(open, sheet, { panes: null })) return false

  sheet.sheet = { ...sheet.sheet, view: { ...sheet.sheet.view, panes: null } }
  return true
}

/** How large the sheet is drawn, between a tenth and four times. */
export function zoomTo(open: OpenWorkbook, sheet: OpenSheet, percent: number): boolean {
  const zoom = Math.round(Math.min(Math.max(percent, 10), 400))
  if (!applied(open, sheet, { zoom })) return false

  sheet.sheet = { ...sheet.sheet, view: { ...sheet.sheet.view, zoom } }
  return true
}

/** Whether the grid is drawn at all, which is a sheet's own answer. */
export function showGridlines(open: OpenWorkbook, sheet: OpenSheet, show: boolean): boolean {
  if (!applied(open, sheet, { showGridLines: show })) return false

  sheet.sheet = { ...sheet.sheet, view: { ...sheet.sheet.view, showGridLines: show } }
  return true
}
