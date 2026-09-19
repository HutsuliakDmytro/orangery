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
  /** Used for every row the caller states no height for. */
  rowHeights?: readonly number[]
  /** The strip down the left holding the row numbers. */
  headerWidth: number
  /** The strip along the top holding the column letters. */
  headerHeight: number
}

/**
 * The rows and columns held still at the edges.
 *
 * A sheet with two frozen rows scrolls under them: the first two rows are
 * always the first two on screen, and the third row is whichever the scroll
 * has reached. The frozen strip is not a separate grid — it is the same cells
 * drawn at a fixed offset — which is what keeps a column's width the same on
 * both sides of the line.
 */
export interface FrozenPanes {
  rows: number
  columns: number
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

export const heightOfRow = (metrics: GridMetrics, row: number): number =>
  metrics.rowHeights?.[row] ?? metrics.rowHeight

/**
 * How far a row starts from the top, headers aside.
 *
 * The same summing a column needs, and for the same reason: rows can be given
 * their own heights one at a time, and a sheet where one row is taller must
 * not move every row below it by a guess.
 */
export function offsetOfRow(metrics: GridMetrics, row: number): number {
  if (metrics.rowHeights === undefined) return metrics.rowHeight * row

  let offset = 0
  for (let at = 0; at < row; at += 1) offset += heightOfRow(metrics, at)
  return offset
}

/** The row at a distance from the top, or the last one when past the end. */
export function rowAtOffset(metrics: GridMetrics, offset: number, rows: number): number {
  if (metrics.rowHeights === undefined) {
    return Math.max(0, Math.min(Math.floor(offset / metrics.rowHeight), rows - 1))
  }

  let top = 0
  for (let at = 0; at < rows; at += 1) {
    top += heightOfRow(metrics, at)
    if (offset < top) return at
  }

  return Math.max(rows - 1, 0)
}

/** How much of the grid the frozen rows and columns take up. */
export function frozenSize(
  metrics: GridMetrics,
  frozen: FrozenPanes | null,
): { width: number; height: number } {
  if (frozen === null) return { width: 0, height: 0 }

  return {
    width: offsetOfColumn(metrics, frozen.columns),
    height: offsetOfRow(metrics, frozen.rows),
  }
}

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
  metrics.headerHeight + offsetOfRow(metrics, rows)

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
  frozen: FrozenPanes | null = null,
): { first: number; last: number } {
  const inner = viewport.height - metrics.headerHeight - frozenSize(metrics, frozen).height
  // The scrolling region starts below the frozen rows, which are always on
  // screen and are drawn by whoever asked for them.
  const top = viewport.scrollY + offsetOfRow(metrics, frozen?.rows ?? 0)
  const first = Math.max(frozen?.rows ?? 0, rowAtOffset(metrics, top, rows))
  const last = Math.min(rows - 1, rowAtOffset(metrics, top + inner, rows))

  return { first, last: Math.max(last, first - 1) }
}

export function visibleColumns(
  metrics: GridMetrics,
  viewport: Viewport,
  columns: number,
  frozen: FrozenPanes | null = null,
): { first: number; last: number } {
  const inner = viewport.width - metrics.headerWidth - frozenSize(metrics, frozen).width
  const left = viewport.scrollX + offsetOfColumn(metrics, frozen?.columns ?? 0)
  const first = Math.max(frozen?.columns ?? 0, columnAtOffset(metrics, left, columns))
  const last = columnAtOffset(metrics, left + inner, columns)

  return { first, last: Math.min(last, columns - 1) }
}

/** Where a cell sits inside the viewport, headers and scrolling accounted for. */
export function rectangleOfCell(
  metrics: GridMetrics,
  viewport: Viewport,
  cell: CellAddress,
  frozen: FrozenPanes | null = null,
): Rectangle {
  // A frozen cell is where it always is; a scrolling one moves. The two are
  // the same arithmetic with the scroll left out of it.
  const held = frozen ?? { rows: 0, columns: 0 }
  const scrollX = cell.column < held.columns ? 0 : viewport.scrollX
  const scrollY = cell.row < held.rows ? 0 : viewport.scrollY

  return {
    x: metrics.headerWidth + offsetOfColumn(metrics, cell.column) - scrollX,
    y: metrics.headerHeight + offsetOfRow(metrics, cell.row) - scrollY,
    width: widthOfColumn(metrics, cell.column),
    height: heightOfRow(metrics, cell.row),
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
  frozen: FrozenPanes | null = null,
): CellAddress | null {
  if (point.x < metrics.headerWidth || point.y < metrics.headerHeight) return null

  const held = frozen ?? { rows: 0, columns: 0 }
  const size = frozenSize(metrics, frozen)

  // Inside the frozen strip the scroll does not count, which is what makes it
  // frozen; past it the scroll is added back.
  const acrossFrozen = point.x - metrics.headerWidth < size.width
  const downFrozen = point.y - metrics.headerHeight < size.height

  const x = point.x - metrics.headerWidth + (acrossFrozen ? 0 : viewport.scrollX)
  const y = point.y - metrics.headerHeight + (downFrozen ? 0 : viewport.scrollY)

  const row = rowAtOffset(metrics, y, counts.rows)
  const column = columnAtOffset(metrics, x, counts.columns)

  // Past the last row is empty space, not the last row: a click there means
  // nothing, and returning the bottom cell would select it from a mile away.
  if (counts.rows === 0 || counts.columns === 0) return null
  if (y >= offsetOfRow(metrics, counts.rows)) return null
  if (!downFrozen && row < held.rows) return null
  if (!acrossFrozen && column < held.columns) return null

  return { row, column }
}

/** Which strip of headers a point landed in, or null for the cells. */
export type HeaderHit =
  | { kind: 'column'; index: number }
  | { kind: 'row'; index: number }
  /** The box above the row numbers and left of the letters: everything. */
  | { kind: 'corner' }

/**
 * The header under a point.
 *
 * The companion to `cellAtPoint`, and the reason that one returns null over a
 * header rather than the nearest cell: clicking a letter is a different
 * gesture from clicking a cell, and it selects a different thing.
 */
export function headerAtPoint(
  metrics: GridMetrics,
  viewport: Viewport,
  point: { x: number; y: number },
  counts: { rows: number; columns: number },
  frozen: FrozenPanes | null = null,
): HeaderHit | null {
  const overRows = point.x < metrics.headerWidth
  const overColumns = point.y < metrics.headerHeight

  if (overRows && overColumns) return { kind: 'corner' }
  if (!overRows && !overColumns) return null

  const size = frozenSize(metrics, frozen)

  if (overColumns) {
    const acrossFrozen = point.x - metrics.headerWidth < size.width
    const x = point.x - metrics.headerWidth + (acrossFrozen ? 0 : viewport.scrollX)
    return { kind: 'column', index: columnAtOffset(metrics, x, counts.columns) }
  }

  const downFrozen = point.y - metrics.headerHeight < size.height
  const y = point.y - metrics.headerHeight + (downFrozen ? 0 : viewport.scrollY)
  return { kind: 'row', index: rowAtOffset(metrics, y, counts.rows) }
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
