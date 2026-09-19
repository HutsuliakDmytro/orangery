/**
 * The grid surface, shared.
 *
 * A chart's data editor is four columns of it; a worksheet is the same
 * component with a million rows behind the same window. Keeping one of these
 * is what stops the two from drifting into two different spreadsheets.
 */

export { columnName, DataGrid } from './data-grid'
export type { DataGridProps } from './data-grid'
export {
  cellAtPoint,
  columnAtOffset,
  offsetOfColumn,
  rectangleOfCell,
  scrollToCell,
  totalHeight,
  totalWidth,
  visibleColumns,
  visibleRows,
  widthOfColumn,
} from './layout'
export type { CellAddress, GridMetrics, Rectangle, Viewport } from './layout'
