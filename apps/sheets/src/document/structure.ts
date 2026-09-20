import { adjustFormula, putCell } from '@orangery/ooxml-spreadsheet'
import type { BandChange, Cell } from '@orangery/ooxml-spreadsheet'
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
export function reshape(sheet: OpenSheet, change: BandChange): CellChange[] {
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

  reshapeRows(sheet, change)
  return changes
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

/**
 * The heights and the hiding, moved with the rows they belong to.
 *
 * Not part of the history: a row's height is a property of the row and not of
 * any cell, and the history records cells. Taking a row out and putting it
 * back leaves the rows below it the height they had rather than the height
 * they were given — which is a smaller wrong than an undo that does not put
 * the values back, and is written down here so it is a decision rather than
 * an oversight.
 */
function reshapeRows(sheet: OpenSheet, change: BandChange): void {
  if (change.axis !== 'row') return

  const moved = new Map<number, ReturnType<typeof rowsOf>[number]>()

  for (const row of rowsOf(sheet)) {
    if (row.index < change.at) {
      moved.set(row.index, row)
      continue
    }
    if (change.by < 0 && row.index < change.at - change.by) continue

    const to = row.index + change.by
    moved.set(to, { ...row, index: to })
  }

  sheet.cells.properties.clear()
  for (const [index, row] of moved) sheet.cells.properties.set(index, row)
}

const rowsOf = (sheet: OpenSheet) => [...sheet.cells.properties.values()]
