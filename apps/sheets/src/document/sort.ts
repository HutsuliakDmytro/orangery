import { putCell, shiftFormula } from '@orangery/ooxml-spreadsheet'
import type { Cell, CellRange } from '@orangery/ooxml-spreadsheet'
import { cellChanges } from './history'
import type { Change } from './history'
import type { CellChange } from './edit'
import type { OpenWorkbook, OpenSheet } from './workbook'
import { shownText } from './shown'

/**
 * Putting rows in order.
 *
 * Whole rows of the range move together, because a table sorted column by
 * column is a table whose rows no longer mean anything — the single most
 * destructive thing a spreadsheet can be persuaded to do, and the reason
 * every one of them asks before doing it.
 *
 * A formula moves with its row and has its references moved by the same
 * distance, which is what Excel does: sorting is a move, and a formula that
 * said `B2*2` in row 2 says `B5*2` in row 5. References out of the range move
 * too. That is the consequence of treating a sort as a move rather than as a
 * permutation, and it is the same rule, applied without an exception nobody
 * could predict.
 */

/** How the rows are to be ordered. */
export interface SortKey {
  column: number
  ascending: boolean
}

/**
 * Where a value sits in a spreadsheet's order.
 *
 * Numbers first, then text, then the two words, then errors, then blanks —
 * and blanks last however the sort runs, which is the one part that is not a
 * reversal. Excel does that because a column with gaps sorted descending
 * would otherwise begin with the gaps.
 */
const RANK = { number: 0, text: 1, boolean: 2, error: 3, blank: 4 }

interface Sortable {
  rank: number
  number: number
  text: string
}

function sortable(open: OpenWorkbook, cell: Cell | null): Sortable {
  if (cell === null || cell.value === null || cell.value === '') {
    return { rank: RANK.blank, number: 0, text: '' }
  }

  if (cell.type === 'e') return { rank: RANK.error, number: 0, text: cell.value }
  if (cell.type === 'b') return { rank: RANK.boolean, number: cell.value === '1' ? 1 : 0, text: '' }

  if (cell.type === 'n' || cell.type === 'd') {
    const number = Number(cell.value)
    if (Number.isFinite(number)) return { rank: RANK.number, number, text: '' }
  }

  // What is shown rather than what is stored: a shared string is an index,
  // and sorting a column by its indexes would be sorting it by the order the
  // words were first typed anywhere in the workbook.
  return { rank: RANK.text, number: 0, text: shownText(open, cell).toLocaleUpperCase() }
}

function compare(a: Sortable, b: Sortable, ascending: boolean): number {
  // Blanks sink whichever way the rest is going.
  if (a.rank === RANK.blank || b.rank === RANK.blank) {
    return a.rank === b.rank ? 0 : a.rank === RANK.blank ? 1 : -1
  }

  const order =
    a.rank !== b.rank
      ? a.rank - b.rank
      : a.rank === RANK.number || a.rank === RANK.boolean
        ? a.number - b.number
        : a.text.localeCompare(b.text)

  return ascending ? order : -order
}

/**
 * The range with its rows put in order, and what that changed.
 *
 * `header` says the first row is names rather than data and stays where it is,
 * which is what a person means by the top row of their table.
 */
export function sortRows(
  open: OpenWorkbook,
  sheet: OpenSheet,
  range: CellRange,
  keys: readonly SortKey[],
  header: boolean,
): Change[] {
  const top = Math.min(range.from.row, range.to.row) + (header ? 1 : 0)
  const bottom = Math.max(range.from.row, range.to.row)
  const left = Math.min(range.from.column, range.to.column)
  const right = Math.max(range.from.column, range.to.column)
  if (bottom <= top || keys.length === 0) return []

  const rows = Array.from({ length: bottom - top + 1 }, (_, offset) => {
    const row = top + offset
    const cells = new Map<number, Cell>()

    for (let column = left; column <= right; column += 1) {
      const cell = sheet.cells.rows.get(row)?.get(column)
      if (cell !== undefined) cells.set(column, cell)
    }

    return { row, cells }
  })

  const ordered = [...rows].sort((a, b) => {
    for (const key of keys) {
      const order = compare(
        sortable(open, a.cells.get(key.column) ?? null),
        sortable(open, b.cells.get(key.column) ?? null),
        key.ascending,
      )
      if (order !== 0) return order
    }

    // Rows that compare the same keep the order they were in, which is what
    // makes sorting by one column and then another do what people expect.
    return a.row - b.row
  })

  const changes: CellChange[] = []

  for (const [offset, source] of ordered.entries()) {
    const row = top + offset
    if (row === source.row) continue

    const by = { rows: row - source.row, columns: 0 }

    for (let column = left; column <= right; column += 1) {
      const before = rows[offset]?.cells.get(column) ?? null
      const moving = source.cells.get(column) ?? null

      const after: Cell | null =
        moving === null
          ? null
          : {
              ...moving,
              row,
              formula:
                moving.formula === null
                  ? null
                  : { ...moving.formula, text: shiftFormula(moving.formula.text, by) },
            }

      changes.push({ sheet: sheet.path, row, column, before, after })
    }
  }

  // Written after every row has been read, or a row moving up would overwrite
  // one that had not been picked up yet.
  for (const change of changes) {
    if (change.after === null) sheet.cells.rows.get(change.row)?.delete(change.column)
    else putCell(sheet.cells, change.after)
  }

  return cellChanges(changes)
}

/**
 * Whether the first row of a range looks like names rather than data.
 *
 * No numbers on top of some numbers. That is what a table looks like and what
 * a column of figures does not, and it survives the ordinary case of a header
 * row with a blank in it — a stricter rule that wanted every column named
 * would call such a table headerless and sort its names in with its data.
 *
 * A guess, and one Excel makes too. It is offered to the caller rather than
 * made here, so that a sort which got it wrong is a sort somebody can repeat
 * with the other answer.
 */
export function looksLikeHeader(open: OpenWorkbook, sheet: OpenSheet, range: CellRange): boolean {
  const top = Math.min(range.from.row, range.to.row)
  const bottom = Math.max(range.from.row, range.to.row)
  // Two rows say nothing: either could be the header of the other.
  if (bottom - top < 2) return false

  const left = Math.min(range.from.column, range.to.column)
  const right = Math.max(range.from.column, range.to.column)

  const rankAt = (row: number, column: number) =>
    sortable(open, sheet.cells.rows.get(row)?.get(column) ?? null).rank

  let named = false
  for (let column = left; column <= right; column += 1) {
    const rank = rankAt(top, column)
    if (rank === RANK.number) return false
    if (rank === RANK.text) named = true
  }
  if (!named) return false

  for (let row = top + 1; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      if (rankAt(row, column) === RANK.number) return true
    }
  }

  return false
}
