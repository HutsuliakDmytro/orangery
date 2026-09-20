import {
  adjustFormula,
  putCell,
  withColumns,
  withMerge,
  withoutMerges,
} from '@orangery/ooxml-spreadsheet'
import type {
  BandChange,
  Cell,
  CellRange,
  ColumnLook,
  RowProperties,
} from '@orangery/ooxml-spreadsheet'
import { cellChanges } from './history'
import type { Change } from './history'
import type { CellChange } from './edit'
import type { OpenSheet } from './workbook'

/**
 * Putting rows and columns in, and taking them out.
 *
 * Two things happen at once and only one of them is obvious. The cells below
 * an insertion move down — that is the obvious half. The other is that every
 * formula on the sheet, including the ones above the insertion and the ones
 * in another column entirely, may be pointing at a cell that has just moved,
 * and has to be rewritten to point at it where it is now.
 *
 * So this touches everything rather than a band. It is the one operation in
 * the app whose cost is the size of the sheet rather than the size of the
 * selection, and there is no way round it: a sheet where half the formulas
 * were adjusted is worse than one where none were.
 */

/** Where a cell ends up, or null when the band it was in has gone. */
function movedTo(cell: Cell, change: BandChange): { row: number; column: number } | null {
  const index = change.axis === 'row' ? cell.row : cell.column
  if (index < change.at) return { row: cell.row, column: cell.column }

  // Inside a band that was removed.
  if (change.by < 0 && index < change.at - change.by) return null

  return change.axis === 'row'
    ? { row: cell.row + change.by, column: cell.column }
    : { row: cell.row, column: cell.column + change.by }
}

/**
 * The sheet after rows or columns were added or removed.
 *
 * Built by emptying the cells and putting them all back, because a move that
 * walked the existing map in place would overwrite cells it had not visited
 * yet — and which ones depend on which direction the band moved.
 */
export function reshape(sheet: OpenSheet, change: BandChange): Change[] {
  if (change.by === 0) return []

  const changes: CellChange[] = []
  const was = new Map<number, Cell>()

  for (const cells of sheet.cells.rows.values()) {
    for (const cell of cells.values()) was.set(cell.row * 16_384 + cell.column, cell)
  }

  const now = new Map<number, Cell>()

  for (const cell of was.values()) {
    const to = movedTo(cell, change)
    if (to === null) continue

    const formula =
      cell.formula === null
        ? null
        : { ...cell.formula, text: adjustFormula(cell.formula.text, change) }

    now.set(to.row * 16_384 + to.column, { ...cell, row: to.row, column: to.column, formula })
  }

  // Every cell that is not what it was: the ones that moved, the ones moved
  // onto, the ones left behind, and the ones that merely changed a formula.
  for (const key of new Set([...was.keys(), ...now.keys()])) {
    const before = was.get(key) ?? null
    const after = now.get(key) ?? null
    if (same(before, after)) continue

    changes.push({
      sheet: sheet.path,
      row: Math.floor(key / 16_384),
      column: key % 16_384,
      before,
      after,
    })
  }

  sheet.cells.rows.clear()
  for (const cell of now.values()) putCell(sheet.cells, cell)

  return [...cellChanges(changes), ...reshapeRows(sheet, change)]
}

/** Whether two cells would be written identically, one of them possibly absent. */
function same(a: Cell | null, b: Cell | null): boolean {
  if (a === null || b === null) return a === b

  return (
    a.type === b.type &&
    a.value === b.value &&
    a.style === b.style &&
    a.formula?.text === b.formula?.text &&
    a.formula?.kind === b.formula?.kind
  )
}

/** The heights and the hiding, moved with the rows they belong to. */
function reshapeRows(sheet: OpenSheet, change: BandChange): Change[] {
  if (change.axis !== 'row') return []

  const was = new Map(sheet.cells.properties)
  const now = new Map<number, RowProperties>()

  for (const row of was.values()) {
    if (row.index < change.at) {
      now.set(row.index, row)
      continue
    }
    if (change.by < 0 && row.index < change.at - change.by) continue

    const to = row.index + change.by
    now.set(to, { ...row, index: to })
  }

  sheet.cells.properties.clear()
  for (const [index, row] of now) sheet.cells.properties.set(index, row)

  return [...new Set([...was.keys(), ...now.keys()])].flatMap((index): Change[] => {
    const before = was.get(index) ?? null
    const after = now.get(index) ?? null
    if (before === after) return []

    return [{ kind: 'row', sheet: sheet.path, index, before, after }]
  })
}

/**
 * What a run of columns looks like, changed.
 *
 * The whole list of runs, before and after: a sheet has a handful of them, and
 * keeping both versions of the handful is cheaper to write and to read than
 * describing which run was split.
 */
export function resizeColumns(
  sheet: OpenSheet,
  from: number,
  to: number,
  look: Partial<ColumnLook>,
): Change[] {
  const before = sheet.sheet.columns
  const after = withColumns(before, from, to, look)
  sheet.sheet.columns = after

  return [{ kind: 'columns', sheet: sheet.path, before, after }]
}

/** The same for rows, which keep what they look like one row at a time. */
export function resizeRows(
  sheet: OpenSheet,
  from: number,
  to: number,
  look: Partial<
    Pick<RowProperties, 'height' | 'customHeight' | 'hidden' | 'outlineLevel' | 'collapsed'>
  >,
): Change[] {
  const changes: Change[] = []

  for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) {
    const before = sheet.cells.properties.get(index) ?? null
    const after: RowProperties = {
      index,
      height: null,
      customHeight: false,
      hidden: false,
      outlineLevel: null,
      style: null,
      collapsed: false,
      carried: null,
      ...before,
      ...look,
    }

    sheet.cells.properties.set(index, after)
    changes.push({ kind: 'row', sheet: sheet.path, index, before, after })
  }

  return changes
}

/**
 * The cells of a range drawn as one, and the values that cannot survive it.
 *
 * Only the corner's value is kept, because only the corner is drawn: Excel
 * discards the rest and says so, and a merge that quietly kept values nobody
 * can see would be a merge that loses them for good on the next save.
 *
 * The cells themselves are not removed — a merged range is still cells, still
 * addressable — so unmerging gives back an empty grid rather than a hole.
 */
export function merge(sheet: OpenSheet, range: CellRange): Change[] {
  const before = sheet.sheet.merges
  const after = withMerge(before, range)
  sheet.sheet.merges = after

  const changes: Change[] = [{ kind: 'merges', sheet: sheet.path, before, after }]

  const top = Math.min(range.from.row, range.to.row)
  const left = Math.min(range.from.column, range.to.column)
  const emptied: CellChange[] = []

  for (let row = top; row <= Math.max(range.from.row, range.to.row); row += 1) {
    for (let column = left; column <= Math.max(range.from.column, range.to.column); column += 1) {
      if (row === top && column === left) continue

      const existing = sheet.cells.rows.get(row)?.get(column) ?? null
      if (existing === null || existing.value === null) continue

      sheet.cells.rows.get(row)?.delete(column)
      emptied.push({ sheet: sheet.path, row, column, before: existing, after: null })
    }
  }

  return [...changes, ...cellChanges(emptied)]
}

/** The merges a range touches, taken away. */
export function unmerge(sheet: OpenSheet, range: CellRange): Change[] {
  const before = sheet.sheet.merges
  const after = withoutMerges(before, range)
  if (after.length === before.length) return []

  sheet.sheet.merges = after
  return [{ kind: 'merges', sheet: sheet.path, before, after }]
}

/**
 * Rows grouped, or a group taken apart.
 *
 * An outline level is a number on a row, not a bracket around a range: rows
 * one to nine at level 1 *are* the group, and the sheet holds nothing else
 * about it. Which is why grouping is adding one to a number and ungrouping is
 * taking it away, and why two groups next to each other are the same group as
 * far as the file is concerned — Excel behaves that way too, and it surprises
 * people the first time.
 *
 * Seven levels is Excel's limit, and it is a limit rather than a convention:
 * the file has nowhere to put an eighth.
 */
export function groupRows(sheet: OpenSheet, from: number, to: number, by: 1 | -1): Change[] {
  const changes: Change[] = []

  for (let index = Math.min(from, to); index <= Math.max(from, to); index += 1) {
    const level = sheet.cells.properties.get(index)?.outlineLevel ?? 0
    const wanted = Math.max(0, Math.min(7, level + by))
    if (wanted === level) continue

    changes.push(
      ...resizeRows(sheet, index, index, {
        outlineLevel: wanted === 0 ? null : wanted,
        // A row at no level cannot be collapsed, because there is nothing
        // left to collapse it into.
        ...(wanted === 0 ? { collapsed: false, hidden: false } : {}),
      }),
    )
  }

  return changes
}

/**
 * A group folded away, or opened again.
 *
 * What folding does is hide the rows; what it records is `collapsed` on the
 * row below the group, which is where Excel keeps the state and where the
 * little box with the plus in it is drawn. Both are needed: a reader that
 * hid the rows without saying so would open a file whose groups were all
 * shut with no way to see it.
 */
export function collapseRows(
  sheet: OpenSheet,
  from: number,
  to: number,
  folded: boolean,
): Change[] {
  const top = Math.min(from, to)
  const bottom = Math.max(from, to)

  const changes = resizeRows(sheet, top, bottom, { hidden: folded })
  const after = sheet.cells.properties.get(bottom + 1) ?? null

  // The row under the group carries the state, unless the group runs to the
  // bottom of what the sheet has — then there is nowhere to put it, and the
  // hidden rows are the whole of the record.
  if (after !== null || folded) {
    changes.push(...resizeRows(sheet, bottom + 1, bottom + 1, { collapsed: folded }))
  }

  return changes
}

/** The rows either side of a cell that share its outline level, as a group. */
export function groupAround(
  sheet: OpenSheet,
  row: number,
): { top: number; bottom: number; level: number } | null {
  const level = sheet.cells.properties.get(row)?.outlineLevel ?? 0
  if (level === 0) return null

  let top = row
  let bottom = row

  while ((sheet.cells.properties.get(top - 1)?.outlineLevel ?? 0) >= level && top > 0) top -= 1
  while ((sheet.cells.properties.get(bottom + 1)?.outlineLevel ?? 0) >= level) bottom += 1

  return { top, bottom, level }
}
