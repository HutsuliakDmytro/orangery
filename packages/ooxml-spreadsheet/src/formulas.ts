import { columnToIndex, indexToColumn, parseRange } from './reference'
import { cellAt, rowsWithCells } from './cells'
import type { Cell, Formula, SheetCells } from './cells'

/**
 * Formulas written once and meant for many cells.
 *
 * A column of a thousand sums is not a thousand formulas in the file. Excel
 * writes the first one and marks the rest as sharing it: `<f t="shared"
 * ref="B2:B1000" si="0">SUM(A2:A2)</f>` on the one cell, and `<f t="shared"
 * si="0"/>` on every other. What the other cells actually compute is the same
 * text with its relative references moved by however far they sit from the
 * first.
 *
 * An array formula is the other shape of the same idea: one formula over a
 * range, written on the corner cell, with the cached results spread across the
 * cells it covers.
 *
 * Both are expanded when a sheet is read, so that everything above this can
 * ask a cell what its formula is and get an answer. Both are written back the
 * way they came, so long as nothing changed — an expanded file would be a
 * file that grew by a megabyte because somebody opened it.
 *
 * No evaluation happens here. Moving a reference is a question about text.
 */

/**
 * The same formula as seen from a cell so many rows and columns away.
 *
 * `A1` moves, `$A$1` does not, and `$A1` moves down but not across — which is
 * the whole of what the dollar means. Everything that is not a reference is
 * left exactly as it was, including the strings, which is why this walks the
 * text rather than replacing by pattern: `"A1 is empty"` is a message, and a
 * formula that had its own text rewritten would say something else.
 */
export function shiftFormula(text: string, by: { rows: number; columns: number }): string {
  if (text === '' || (by.rows === 0 && by.columns === 0)) return text

  const out: string[] = []
  let at = 0

  while (at < text.length) {
    const here = text[at] ?? ''

    if (here === '"' || here === "'") {
      const end = closingQuote(text, at, here)
      out.push(text.slice(at, end))
      at = end
      continue
    }

    // `Table1[[#Headers],[Total]]` names columns, not cells; nothing inside
    // the brackets is an A1 reference and nothing in them moves.
    if (here === '[') {
      const end = closingBracket(text, at)
      out.push(text.slice(at, end))
      at = end
      continue
    }

    const reference = referenceAt(text, at)
    if (reference === null) {
      out.push(here)
      at += 1
      continue
    }

    out.push(moved(reference, by))
    at = reference.end
  }

  return out.join('')
}

/** Past the closing quote of a literal, doubled quotes inside it included. */
function closingQuote(text: string, from: number, quote: string): number {
  let at = from + 1

  while (at < text.length) {
    if (text[at] !== quote) {
      at += 1
      continue
    }
    // `""` inside a string is one quote, not the end of it.
    if (text[at + 1] === quote) {
      at += 2
      continue
    }
    return at + 1
  }

  return text.length
}

/** Past the bracket that closes this one, nested brackets counted. */
function closingBracket(text: string, from: number): number {
  let depth = 0

  for (let at = from; at < text.length; at += 1) {
    if (text[at] === '[') depth += 1
    if (text[at] === ']') {
      depth -= 1
      if (depth === 0) return at + 1
    }
  }

  return text.length
}

interface FoundReference {
  columnFixed: boolean
  column: number
  rowFixed: boolean
  row: number
  end: number
}

const LAST_ROW = 1_048_576
const IDENTIFIER = /[A-Za-z0-9_.À-￿]/u

const REFERENCE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})/u

/**
 * A cell reference starting exactly here, or null.
 *
 * The hard part is everything that looks like one and is not. `LOG10(` is a
 * function; `A1B2` is a defined name; `_xlfn.XLOOKUP` is a name with a dot in
 * it. So a match only counts when nothing identifier-ish touches either end of
 * it, and when the column and row are ones a sheet actually has.
 */
function referenceAt(text: string, from: number): FoundReference | null {
  const before = from === 0 ? '' : (text[from - 1] ?? '')
  if (before !== '' && (IDENTIFIER.test(before) || before === '$')) return null

  const match = REFERENCE.exec(text.slice(from))
  if (match === null) return null

  const end = from + match[0].length
  const after = text[end] ?? ''
  // A name that carries on, or a function about to be called.
  if (after !== '' && (IDENTIFIER.test(after) || after === '(')) return null

  const column = columnToIndex((match[2] ?? '').toUpperCase())
  const row = Number(match[4])
  if (column === null || column > 16_383 || row < 1 || row > LAST_ROW) return null

  return {
    columnFixed: match[1] === '$',
    column,
    rowFixed: match[3] === '$',
    row: row - 1,
    end,
  }
}

/** The reference written out again, moved by as much as it is allowed to move. */
function moved(reference: FoundReference, by: { rows: number; columns: number }): string {
  const column = reference.columnFixed ? reference.column : reference.column + by.columns
  const row = reference.rowFixed ? reference.row : reference.row + by.rows

  // A reference pushed off the sheet is the error Excel puts there, and it is
  // the answer rather than a crash: the formula is still a formula.
  if (column < 0 || column > 16_383 || row < 0 || row >= LAST_ROW) return '#REF!'

  return (
    (reference.columnFixed ? '$' : '') +
    indexToColumn(column) +
    (reference.rowFixed ? '$' : '') +
    String(row + 1)
  )
}

/** Where a group of shared cells gets its formula from. */
export interface SharedMaster {
  row: number
  column: number
  text: string
}

/** The cell each shared group is written on, by the id the group is known by. */
export function sharedMasters(sheet: SheetCells): Map<number, SharedMaster> {
  const masters = new Map<number, SharedMaster>()

  for (const index of rowsWithCells(sheet)) {
    for (const cell of (sheet.rows.get(index) ?? new Map<number, Cell>()).values()) {
      const formula = cell.formula
      if (formula === null || formula.kind !== 'shared' || formula.shared === null) continue
      // The master is the one that carries the text; the rest point at it.
      if (formula.text === '') continue

      masters.set(formula.shared, { row: cell.row, column: cell.column, text: formula.text })
    }
  }

  return masters
}

/**
 * Every cell of a shared group and every cell of an array given its formula.
 *
 * Done once when the sheet is read, so nothing above this has to know that a
 * formula can be written somewhere else. The cells are changed in place: the
 * model is a sparse map of a million cells and a copy of it to add a string to
 * a thousand of them would be a copy of all of it.
 */
export function expandFormulas(sheet: SheetCells): void {
  const masters = sharedMasters(sheet)
  const arrays: { range: ReturnType<typeof parseRange>; text: string }[] = []

  for (const index of rowsWithCells(sheet)) {
    for (const cell of (sheet.rows.get(index) ?? new Map<number, Cell>()).values()) {
      const formula = cell.formula
      if (formula === null) continue

      if (formula.kind === 'array' && formula.ref !== null && formula.text !== '') {
        arrays.push({ range: parseRange(formula.ref), text: formula.text })
        continue
      }

      if (formula.kind !== 'shared' || formula.text !== '' || formula.shared === null) continue

      const master = masters.get(formula.shared)
      if (master === undefined) continue

      cell.formula = {
        ...formula,
        text: shiftFormula(master.text, {
          rows: cell.row - master.row,
          columns: cell.column - master.column,
        }),
      }
    }
  }

  // An array formula is one formula over a range, not a formula per cell, so
  // the cells it covers get the same text rather than a shifted one.
  for (const array of arrays) {
    const range = array.range
    if (range === null) continue

    for (let row = range.from.row; row <= range.to.row; row += 1) {
      for (let column = range.from.column; column <= range.to.column; column += 1) {
        const cell = cellAt(sheet, { row, column })
        if (cell === null || cell.formula !== null) continue

        cell.formula = { text: array.text, kind: 'array', shared: null, ref: null }
      }
    }
  }
}

/**
 * The formula to write for a cell, after the expansion has been undone.
 *
 * Null means the cell writes no `<f>` at all, which is what the cells covered
 * by an array formula do — the corner carries it for all of them.
 *
 * A shared follower is written back as a follower so long as it still says
 * what the group says. One that no longer does is not a follower any more, and
 * is written as a formula of its own — which is what Excel does to a cell
 * somebody has edited out of a group.
 */
export function collapsedFormula(cell: Cell, masters: Map<number, SharedMaster>): Formula | null {
  const formula = cell.formula
  if (formula === null) return null

  if (formula.kind === 'array') return formula.ref === null ? null : formula

  if (formula.kind !== 'shared' || formula.shared === null) return formula
  // The master itself, which is the one with a `ref`.
  if (formula.ref !== null) return formula

  const master = masters.get(formula.shared)
  if (master === undefined) return formula

  const expected = shiftFormula(master.text, {
    rows: cell.row - master.row,
    columns: cell.column - master.column,
  })

  return formula.text === expected
    ? { ...formula, text: '' }
    : { text: formula.text, kind: 'normal', shared: null, ref: null }
}
