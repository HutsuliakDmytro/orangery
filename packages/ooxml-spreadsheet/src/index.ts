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
export type { DefinedName, SheetEntry, Workbook } from './workbook'
export { readNotes, readPeople, readSheetComments, readThreads } from './comments'
export type { Note, Reply, SheetComments, Thread } from './comments'
export { readTable, readTables, tableAt } from './tables'
export type { Table, TableColumn, TableStyle } from './tables'
export { applyTint, paletteOf, resolveColor } from './colors'
export type { ColorPalette } from './colors'
export { formatCodeOf, isDateFormat, readPartialFont, readStyles, resolveStyle } from './styles'
export { plainText, readRichStrings, readRichText } from './rich-text'
export type { RichText, TextRun } from './rich-text'
export type {
  Alignment,
  Border,
  BorderEdge,
  CellFormat,
  DifferentialFormat,
  Fill,
  Font,
  ResolvedStyle,
  StyleColor,
  Styles,
} from './styles'
export {
  borderIndex,
  cellFormatIndex,
  fillIndex,
  fontIndex,
  noStyleChanges,
  numberFormatId,
  patchStyles,
  sameCellFormat,
  styleShowing,
  styleWith,
} from './styles-edit'
export type { LookChange, StyleChanges } from './styles-edit'
export {
  blockFromHtml,
  blockFromText,
  blockOf,
  blockToHtml,
  blockToText,
  sameSession,
  thisSession,
} from './clipboard'
export type { CellBlock } from './clipboard'
export { removeCalcChain, writeWorkbook } from './save'
export type { SaveOptions, SheetToWrite } from './save'
export {
  adjustFormula,
  collapsedFormula,
  expandFormulas,
  sharedMasters,
  shiftFormula,
} from './formulas'
export type { BandChange, SharedMaster } from './formulas'
export { EMU_PER_POINT, drawingRelationshipId, readSheetDrawings } from './drawing'
export type { AnchorPoint, DrawingAnchor, DrawingContent, SheetDrawing } from './drawing'
export { readConditionalFormats, rangeCovers } from './conditional'
export type {
  ColorScale,
  ConditionalFormat,
  ConditionalRule,
  ConditionalValue,
  DataBar,
  IconSet,
} from './conditional'
export { highlightsOf } from './highlight'
export type {
  CellBar,
  CellHighlight,
  CellIcon,
  HighlightOptions,
  HighlightValue,
} from './highlight'
export {
  passes,
  readAutoFilter,
  replaceAutoFilter,
  withFilter,
  writeAutoFilter,
} from './autofilter'
export type { AutoFilter, FilterColumn, FilterCondition, FilterCriteria } from './autofilter'
export { mergeCovering, replaceMerges, withMerge, withoutMerges, writeMerges } from './merges'
export { replaceColumns, widthOfColumnIn, withColumns, writeColumns } from './columns'
export type { ColumnLook } from './columns'
export { isColumnHidden, mergeAt, readWorksheet, widthOfColumn } from './worksheet'
export type { ColumnRange, FrozenPanes, SheetFormat, SheetView, Worksheet } from './worksheet'
export { newWorkbook } from './new-workbook'
export type { NewSheet } from './new-workbook'
export {
  cellAt,
  cellsOfRow,
  emptySheet,
  extentOf,
  positionOf,
  putCell,
  regionAround,
  rowsWithCells,
} from './cells'
export type { Cell, CellType, Formula, FormulaKind, RowProperties, SheetCells } from './cells'
export {
  decodeText,
  encodeText,
  readSheetData,
  replaceSheetData,
  scanSheetData,
  writeSheetData,
} from './sheet-data'
export type { SheetDataHandlers } from './sheet-data'
export { clearCell, insertRow, openSheet, readCell, removeRow, saveSheet, writeCell } from './sheet'
export type { CellValue, Sheet } from './sheet'

export {
  addSheet,
  freeName,
  moveSheet,
  removeSheet,
  renameSheet,
  setSheetState,
  setTabColor,
} from './sheets-edit'

export { changeView } from './view-edit'
export type { ViewChange } from './view-edit'
