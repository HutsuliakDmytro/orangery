/**
 * SpreadsheetML, as much of it as anything needs today.
 *
 * A chart in a deck or a document embeds a workbook and edits cells in it; the
 * spreadsheet app will open the same parts and model far more of them. This is
 * the part both share, and it grows towards the second without the first ever
 * having to know (`apps/sheets/PLAN.md`, phase 1).
 */

export {
  cellsOfRange,
  columnToIndex,
  extendedRange,
  formatReference,
  indexToColumn,
  parseRange,
  parseReference,
} from './reference'
export type { CellPosition, CellRange } from './reference'
export { readSharedStrings, readWorkbook, sheetPath, textOf } from './workbook'
export type { SheetEntry, Workbook } from './workbook'
export { newWorkbook } from './new-workbook'
export type { NewSheet } from './new-workbook'
export { clearCell, insertRow, openSheet, readCell, removeRow, saveSheet, writeCell } from './sheet'
export type { CellValue, Sheet } from './sheet'
