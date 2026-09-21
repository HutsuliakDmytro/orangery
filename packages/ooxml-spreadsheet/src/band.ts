import type { BandChange } from './formulas'
import type { CellPosition, CellRange } from './reference'

/**
 * Rectangles seen from after rows or columns were added or removed.
 *
 * A formula is rewritten reference by reference (`adjustFormula`), and that is
 * the easy half of an insertion. The other half is everything on a sheet that
 * is a rectangle rather than a formula: the merges, the conditional rules, the
 * validations, the tables, the filter, the links. None of them are cells and
 * none of them move when the cells do, so a sheet that shifted only its cells
 * would come back with its colours on the wrong rows.
 *
 * A rectangle behaves differently from a point, and the difference is the
 * whole of this file. Inserting a row *above* a range moves it down; inserting
 * one *inside* it makes it taller, because the rows it covered are still the
 * rows it covers and there is now one more of them between them. Excel does
 * this, every spreadsheet does this, and it is what somebody means when they
 * add a line to the middle of a table.
 */

const LAST_ROW = 1_048_576
const LAST_COLUMN = 16_384

/** Where a single cell ends up, or null when the band it sat in has gone. */
export function movedPosition(at: CellPosition, change: BandChange): CellPosition | null {
  const index = change.axis === 'row' ? at.row : at.column
  const moved = movedIndex(index, change)
  if (moved === null) return null

  return change.axis === 'row' ? { ...at, row: moved } : { ...at, column: moved }
}

/** Where one row or column number ends up, or null when it was removed. */
export function movedIndex(index: number, change: BandChange): number | null {
  if (index < change.at) return index
  if (change.by < 0 && index < change.at - change.by) return null

  return index + change.by
}

/**
 * A rectangle after the change, or null when nothing of it is left.
 *
 * Null rather than an empty rectangle: a rule over no cells, a merge of
 * nothing, a table with no rows are all things a file can technically hold and
 * nothing can mean, and the caller's job is to drop them rather than to carry
 * them.
 *
 * The edges are clamped to the sheet. A range that already reached the bottom
 * — which is how `A:A` is stored, and how Excel writes a whole-column rule —
 * cannot be pushed past it, and a range pushed off the end entirely is gone
 * for the same reason a deleted one is.
 */
export function movedRange(range: CellRange, change: BandChange): CellRange | null {
  if (change.by === 0) return range

  const limit = change.axis === 'row' ? LAST_ROW : LAST_COLUMN
  const read = (at: CellPosition): number => (change.axis === 'row' ? at.row : at.column)

  const first = Math.min(read(range.from), read(range.to))
  const last = Math.max(read(range.from), read(range.to))

  const start = movedStart(first, change)
  const end = movedEnd(last, change)

  if (end < start || start >= limit) return null

  const at = (position: CellPosition, index: number): CellPosition =>
    change.axis === 'row' ? { ...position, row: index } : { ...position, column: index }

  return {
    ...range,
    from: at(range.from, start),
    to: at(range.to, Math.min(end, limit - 1)),
  }
}

/**
 * The first surviving line at or after this one.
 *
 * A deletion that swallowed the top of a range leaves the range starting where
 * the band was: the rows below it have moved up into that place, and they are
 * the rows the range still covers.
 *
 * Exported for the things that are a rectangle in a file that is not this
 * model — a drawing's anchor, which is patched as text where it lies.
 */
export function movedStart(index: number, change: BandChange): number {
  if (index < change.at) return index
  if (change.by < 0 && index < change.at - change.by) return change.at

  return index + change.by
}

/**
 * The last surviving line at or before this one.
 *
 * An insertion *at* the bottom edge is inside the range, not after it — which
 * is why this side counts from `at` and the other side does not. Add a row at
 * the last row of a merged block and the block grows; add one at the first row
 * and the block moves. Both are what a person expects, and the asymmetry is
 * only visible when you write the two rules down next to each other.
 */
export function movedEnd(index: number, change: BandChange): number {
  if (index < change.at) return index
  if (change.by < 0 && index < change.at - change.by) return change.at - 1

  return index + change.by
}

/** The rectangles that are left, in the order they were given. */
export const movedRanges = (ranges: readonly CellRange[], change: BandChange): CellRange[] =>
  ranges
    .map((range) => movedRange(range, change))
    .filter((range): range is CellRange => range !== null)
