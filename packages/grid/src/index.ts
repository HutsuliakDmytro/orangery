/**
 * The grid surface, shared.
 *
 * A chart's data editor is four columns of it; a worksheet is the same
 * component with a million rows behind the same window. Keeping one of these
 * is what stops the two from drifting into two different spreadsheets.
 */

export { defaultAlign } from './cell-style'
export type { CellBorders, CellStyle } from './cell-style'
export { columnName, DataGrid } from './data-grid'
export type { DataGridProps } from './data-grid'
export {
  cellAtPoint,
  columnAtOffset,
  frozenSize,
  heightOfRow,
  offsetOfColumn,
  offsetOfRow,
  rectangleOfCell,
  rowAtOffset,
  scrollToCell,
  totalHeight,
  totalWidth,
  visibleColumns,
  visibleRows,
  widthOfColumn,
} from './layout'
export type { CellAddress, FrozenPanes, GridMetrics, Rectangle, Viewport } from './layout'
