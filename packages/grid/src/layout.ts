/**
 * Where the cells are.
 *
 * Kept apart from the drawing on purpose: everything here is arithmetic over
 * numbers, which is the part that decides whether a click lands on the cell
 * under the pointer and whether a million rows scroll without a stutter. It is
 * also the part that can be tested without a canvas.
 */

export interface GridMetrics {
  rowHeight: number
  /** Used for every column the caller states no width for. */
  columnWidth: number
  columnWidths?: readonly number[]
  /** The strip down the left holding the row numbers. */
  headerWidth: number
  /** The strip along the top holding the column letters. */
  headerHeight: number
}

export interface Viewport {
  scrollX: number
  scrollY: number
  width: number
  height: number
}

export interface CellAddress {
  row: number
  column: number
}

export interface Rectangle {
  x: number
  y: number
  width: number
  height: number
}

export const widthOfColumn = (metrics: GridMetrics, column: number): number =>
  metrics.columnWidths?.[column] ?? metrics.columnWidth

/**
 * How far a column starts from the left edge of the grid, headers aside.
 *
 * Summed rather than multiplied because columns can be resized one at a time.
 * A sheet with a hundred thousand columns would want the running totals cached;
 * a chart's workbook has four, and the cache would be the slower answer.
 */
export function offsetOfColumn(metrics: GridMetrics, column: number): number {
  if (metrics.columnWidths === undefined) return metrics.columnWidth * column

  let offset = 0
  for (let at = 0; at < column; at += 1) offset += widthOfColumn(metrics, at)
  return offset
}

/** The column at a distance from the left, or the last one when past the end. */
export function columnAtOffset(metrics: GridMetrics, offset: number, columns: number): number {
  if (metrics.columnWidths === undefined) {
    return Math.max(0, Math.min(Math.floor(offset / metrics.columnWidth), columns - 1))
  }

  let left = 0
  for (let at = 0; at < columns; at += 1) {
    left += widthOfColumn(metrics, at)
    if (offset < left) return at
  }

  return Math.max(columns - 1, 0)
}

export const totalWidth = (metrics: GridMetrics, columns: number): number =>
  metrics.headerWidth + offsetOfColumn(metrics, columns)

export const totalHeight = (metrics: GridMetrics, rows: number): number =>
  metrics.headerHeight + metrics.rowHeight * rows

/**
 * The rows and columns a viewport can show.
 *
 * One extra at each end: a row half-scrolled off the top is still a row
 * somebody can see, and leaving it out draws a blank stripe along the edge.
 */
export function visibleRows(
  metrics: GridMetrics,
  viewport: Viewport,
  rows: number,
): { first: number; last: number } {
  const inner = viewport.height - metrics.headerHeight
  const first = Math.max(0, Math.floor(viewport.scrollY / metrics.rowHeight))
  const last = Math.min(rows - 1, Math.ceil((viewport.scrollY + inner) / metrics.rowHeight))

  return { first, last: Math.max(last, first - 1) }
}

export function visibleColumns(
  metrics: GridMetrics,
  viewport: Viewport,
  columns: number,
): { first: number; last: number } {
  const inner = viewport.width - metrics.headerWidth
  const first = columnAtOffset(metrics, viewport.scrollX, columns)
  const last = columnAtOffset(metrics, viewport.scrollX + inner, columns)

  return { first, last: Math.min(last, columns - 1) }
}

/** Where a cell sits inside the viewport, headers and scrolling accounted for. */
export function rectangleOfCell(
  metrics: GridMetrics,
  viewport: Viewport,
  cell: CellAddress,
): Rectangle {
  return {
    x: metrics.headerWidth + offsetOfColumn(metrics, cell.column) - viewport.scrollX,
    y: metrics.headerHeight + metrics.rowHeight * cell.row - viewport.scrollY,
    width: widthOfColumn(metrics, cell.column),
    height: metrics.rowHeight,
  }
}

/**
 * The cell under a point of the viewport, or null over a header.
 *
 * A click on a header is a different gesture — selecting a whole row or column
 * — and returning the first cell for it would make the grid select A1 whenever
 * somebody reached for the letter above it.
 */
export function cellAtPoint(
  metrics: GridMetrics,
  viewport: Viewport,
  point: { x: number; y: number },
  counts: { rows: number; columns: number },
): CellAddress | null {
  if (point.x < metrics.headerWidth || point.y < metrics.headerHeight) return null

  const row = Math.floor((point.y - metrics.headerHeight + viewport.scrollY) / metrics.rowHeight)
  const column = columnAtOffset(
    metrics,
    point.x - metrics.headerWidth + viewport.scrollX,
    counts.columns,
  )

  return row < 0 || row >= counts.rows || counts.columns === 0 ? null : { row, column }
}

/**
 * The scroll position that brings a cell into view, moving as little as it can.
 *
 * What keyboard navigation needs: arrowing down the last visible row should
 * scroll by one row, not centre the selection and lose the reader's place.
 */
export function scrollToCell(
  metrics: GridMetrics,
  viewport: Viewport,
  cell: CellAddress,
): { scrollX: number; scrollY: number } {
  const rect = {
    left: offsetOfColumn(metrics, cell.column),
    right: offsetOfColumn(metrics, cell.column) + widthOfColumn(metrics, cell.column),
    top: metrics.rowHeight * cell.row,
    bottom: metrics.rowHeight * (cell.row + 1),
  }

  const inner = {
    width: viewport.width - metrics.headerWidth,
    height: viewport.height - metrics.headerHeight,
  }

  const scrollX =
    rect.left < viewport.scrollX
      ? rect.left
      : rect.right > viewport.scrollX + inner.width
        ? rect.right - inner.width
        : viewport.scrollX

  const scrollY =
    rect.top < viewport.scrollY
      ? rect.top
      : rect.bottom > viewport.scrollY + inner.height
        ? rect.bottom - inner.height
        : viewport.scrollY

  return { scrollX: Math.max(0, scrollX), scrollY: Math.max(0, scrollY) }
}
