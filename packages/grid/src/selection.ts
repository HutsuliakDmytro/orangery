import type { CellAddress } from './layout'

/**
 * What is selected.
 *
 * A spreadsheet selection is not a cell. It is a list of rectangles — because
 * `Mod`-clicking adds one — each remembering which corner it was dragged from,
 * because that corner is what `Shift` extends away from. And one of the cells
 * is the active one: the cell the keyboard moves from, the cell a typed value
 * would land in, the cell the name box shows.
 *
 * Kept here, away from the drawing, for the same reason the layout is: this is
 * arithmetic over numbers, and it decides whether `Shift`-clicking does what a
 * person expects.
 */

export interface GridRange {
  /** Where the range was started from, which `Shift` keeps still. */
  anchor: CellAddress
  /** Where it was dragged or extended to. */
  focus: CellAddress
}

export interface GridSelection {
  /** Oldest first. The last one is what the keyboard extends. */
  ranges: GridRange[]
  /** Inside the last range, always. */
  active: CellAddress
}

/** The bounds of a range, whichever way round it was made. */
export interface Bounds {
  top: number
  left: number
  bottom: number
  right: number
}

export const boundsOf = (range: GridRange): Bounds => ({
  top: Math.min(range.anchor.row, range.focus.row),
  left: Math.min(range.anchor.column, range.focus.column),
  bottom: Math.max(range.anchor.row, range.focus.row),
  right: Math.max(range.anchor.column, range.focus.column),
})

export const singleCell = (cell: CellAddress): GridSelection => ({
  ranges: [{ anchor: cell, focus: cell }],
  active: cell,
})

/** The range the keyboard is working in, which is the last one added. */
export const lastRange = (selection: GridSelection): GridRange =>
  selection.ranges[selection.ranges.length - 1] ?? {
    anchor: selection.active,
    focus: selection.active,
  }

const within = (bounds: Bounds, cell: CellAddress): boolean =>
  cell.row >= bounds.top &&
  cell.row <= bounds.bottom &&
  cell.column >= bounds.left &&
  cell.column <= bounds.right

export const coversCell = (selection: GridSelection, cell: CellAddress): boolean =>
  selection.ranges.some((range) => within(boundsOf(range), cell))

/**
 * Whether a whole row is selected, which is what highlights its number.
 *
 * "Whole" means to the last column the grid has: a range that happens to cover
 * every column is the same thing as one made by clicking the row header, and
 * telling them apart would mean remembering how a selection was made rather
 * than what it is.
 */
export const coversRow = (selection: GridSelection, row: number, columns: number): boolean =>
  selection.ranges.some((range) => {
    const bounds = boundsOf(range)
    return (
      row >= bounds.top && row <= bounds.bottom && bounds.left === 0 && bounds.right >= columns - 1
    )
  })

export const coversColumn = (selection: GridSelection, column: number, rows: number): boolean =>
  selection.ranges.some((range) => {
    const bounds = boundsOf(range)
    return (
      column >= bounds.left &&
      column <= bounds.right &&
      bounds.top === 0 &&
      bounds.bottom >= rows - 1
    )
  })

/** How many cells are selected, counting an overlap once. */
export function selectedCount(selection: GridSelection): number {
  if (selection.ranges.length === 1) {
    const bounds = boundsOf(selection.ranges[0] ?? lastRange(selection))
    return (bounds.bottom - bounds.top + 1) * (bounds.right - bounds.left + 1)
  }

  // Overlapping ranges are what `Mod`-clicking a cell twice makes, and a count
  // that reported it twice would be a count of clicks rather than of cells.
  const seen = new Set<number>()
  for (const range of selection.ranges) {
    const bounds = boundsOf(range)
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      for (let column = bounds.left; column <= bounds.right; column += 1) {
        seen.add(row * 16_384 + column)
      }
    }
  }

  return seen.size
}

/** The selection with its last range extended to a new corner. */
export function extendedTo(selection: GridSelection, cell: CellAddress): GridSelection {
  const ranges = [...selection.ranges]
  const last = lastRange(selection)
  ranges[Math.max(ranges.length - 1, 0)] = { anchor: last.anchor, focus: cell }

  // The active cell stays where it was: `Shift`-clicking picks a range, it
  // does not move the cell a value would be typed into.
  return { ranges, active: selection.active }
}

/** The selection with another range added, which is what `Mod`-clicking does. */
export const withRange = (selection: GridSelection, range: GridRange): GridSelection => ({
  ranges: [...selection.ranges, range],
  active: range.anchor,
})

/** Everything, as a range that reaches the far corner. */
export const everything = (rows: number, columns: number): GridSelection => ({
  ranges: [{ anchor: { row: 0, column: 0 }, focus: { row: rows - 1, column: columns - 1 } }],
  active: { row: 0, column: 0 },
})

export const wholeRows = (from: number, to: number, columns: number): GridRange => ({
  anchor: { row: from, column: 0 },
  focus: { row: to, column: columns - 1 },
})

export const wholeColumns = (from: number, to: number, rows: number): GridRange => ({
  anchor: { row: 0, column: from },
  focus: { row: rows - 1, column: to },
})

export type Direction = 'up' | 'down' | 'left' | 'right'

const STEPS: Record<Direction, CellAddress> = {
  up: { row: -1, column: 0 },
  down: { row: 1, column: 0 },
  left: { row: 0, column: -1 },
  right: { row: 0, column: 1 },
}

/**
 * Where `Mod` and an arrow land: the edge of the run of cells you are in.
 *
 * Standing on a filled cell with a filled neighbour, it goes to the last one
 * before the gap. Standing anywhere else, it crosses the gap to the first
 * filled cell beyond it. That is Excel's rule, and it is the difference
 * between jumping to the bottom of a column of figures and jumping to row a
 * million.
 */
export function edgeFrom(
  cell: CellAddress,
  direction: Direction,
  counts: { rows: number; columns: number },
  filled: (cell: CellAddress) => boolean,
): CellAddress {
  const step = STEPS[direction]
  const inside = (one: CellAddress) =>
    one.row >= 0 && one.row < counts.rows && one.column >= 0 && one.column < counts.columns
  const next = (one: CellAddress) => ({ row: one.row + step.row, column: one.column + step.column })

  let here = cell
  if (!inside(next(here))) return here

  if (filled(next(here))) {
    while (inside(next(here)) && filled(next(here))) here = next(here)
    return here
  }

  while (inside(next(here)) && !filled(next(here))) here = next(here)
  return inside(next(here)) ? next(here) : here
}

/** One cell along, kept inside the grid. */
export function stepFrom(
  cell: CellAddress,
  direction: Direction,
  counts: { rows: number; columns: number },
): CellAddress {
  const step = STEPS[direction]

  return {
    row: Math.max(0, Math.min(cell.row + step.row, counts.rows - 1)),
    column: Math.max(0, Math.min(cell.column + step.column, counts.columns - 1)),
  }
}
