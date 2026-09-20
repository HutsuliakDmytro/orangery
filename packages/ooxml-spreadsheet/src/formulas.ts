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
  if (by.rows === 0 && by.columns === 0) return text

  return mapReferences(text, (reference) => moved(reference, by))
}

/**
 * Every A1 reference in a formula, rewritten.
 *
 * The walk that both kinds of move share, and the only part of either that is
 * difficult. Almost all of it is about what must *not* be rewritten: the words
 * of a string, the column names inside a structured reference, a function that
 * happens to be three letters and a number.
 */
function mapReferences(
  text: string,
  rewrite: (reference: FoundReference, on: SheetPrefix | null) => string,
): string {
  if (text === '') return text

  const out: string[] = []
  let at = 0

  while (at < text.length) {
    const here = text[at] ?? ''

    // `Sheet2!`, `'My Sheet'!`, `[1]Book!`, `Sheet1:Sheet3!` — pushed through
    // untouched, and remembered, because what a reference after one means
    // depends on it.
    const prefix = sheetPrefixAt(text, at)
    if (prefix !== null) {
      out.push(text.slice(at, prefix.end))
      at = prefix.end

      const reference = referenceAt(text, at)
      if (reference !== null) {
        out.push(rewrite(reference, prefix))
        at = reference.end

        // `Sheet2!A1:B2` names the sheet once. The far end of the range is on
        // the same sheet as the near one, and a walk that forgot the prefix at
        // the colon would decide it was on this one.
        const far = text[at] === ':' ? referenceAt(text, at + 1) : null
        if (far !== null) {
          out.push(':', rewrite(far, prefix))
          at = far.end
        }
      }
      continue
    }

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

    out.push(rewrite(reference, null))
    at = reference.end
  }

  return out.join('')
}

/**
 * What stands before the `!` of a reference.
 *
 * Read for one purpose: deciding whether a reference is talking about the
 * sheet whose rows have just moved. Which sheet it names matters less than
 * whether it names one at all — a span names several and a book prefix names
 * another file, and neither can be answered with a single moved row.
 */
export interface SheetPrefix {
  /** The sheet, as written and unquoted; null when it names more than one. */
  name: string | null
  /** `[1]Sheet1!` or `[Book.xlsx]Sheet1!` — another workbook entirely. */
  external: boolean
  /** `Sheet1:Sheet3!` — the same cell on each of a run of sheets. */
  span: boolean
  end: number
}

/** A sheet name as it may be written: bare, or quoted with `''` for a quote. */
const SHEET_NAME = String.raw`(?:'(?:[^']|'')*'|[A-Za-z0-9_.\u00C0-\uFFFF]+)`
const SHEET_PREFIX = new RegExp(
  String.raw`^(\[[^\]]*\])?(${SHEET_NAME})(?::(${SHEET_NAME}))?!`,
  'u',
)

const unquoted = (name: string): string =>
  name.startsWith("'") ? name.slice(1, -1).replace(/''/gu, "'") : name

/** The prefix starting exactly here, or null. */
function sheetPrefixAt(text: string, from: number): SheetPrefix | null {
  const before = from === 0 ? '' : (text[from - 1] ?? '')
  // Mid-name: `A1.Sheet1!` is not a prefix, and neither is the tail of one.
  if (before !== '' && IDENTIFIER.test(before)) return null

  const match = SHEET_PREFIX.exec(text.slice(from))
  if (match === null) return null

  const span = match[3] !== undefined

  return {
    name: span ? null : unquoted(match[2] ?? ''),
    external: match[1] !== undefined,
    span,
    end: from + match[0].length,
  }
}

/** Rows or columns inserted at a place, or taken away from it. */
export interface BandChange {
  axis: 'row' | 'column'
  /** The first index of the band, counting from nought. */
  at: number
  /** How many were put in; negative for how many were taken out. */
  by: number
}

/**
 * Which sheet a band changed on, and which sheet a formula is written on.
 *
 * Both are needed and neither can be guessed. A formula on another sheet can
 * point at this one and has to be adjusted; a formula on this one can point
 * at another and must not be. Left out, every reference is adjusted — which
 * is right for a workbook of one sheet and for a caller that has already
 * decided.
 */
export interface FormulaPlace {
  /** The sheet whose rows or columns moved. */
  changed: string
  /** The sheet the formula sits on, which is what a bare `A1` means. */
  own: string
}

/** Sheet names are matched the way Excel matches them, which is loosely. */
const sameSheet = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/**
 * Whether this reference is talking about the sheet that changed.
 *
 * A reference into another workbook never is: an external reference is
 * carried through untouched, and a row put into this file says nothing about
 * the rows of that one.
 *
 * A reference across a span of sheets — `Sheet1:Sheet3!A5` — is left alone
 * too, and that is a decision rather than an omission. It means A5 on each of
 * three sheets, and a row inserted on one of them would make it mean a
 * different row on that sheet and the same row on the others. One reference
 * cannot say that, so moving it would be right in one place and wrong in two.
 */
function concerns(on: SheetPrefix | null, place: FormulaPlace | undefined): boolean {
  if (place === undefined) return true
  if (on === null) return sameSheet(place.own, place.changed)
  if (on.external || on.span || on.name === null) return false

  return sameSheet(on.name, place.changed)
}

/**
 * A formula seen from after rows or columns were added or removed.
 *
 * A different question from moving a formula, and answered differently: here
 * the formula stays where it is and the sheet under it changes shape. A
 * reference below the insertion moves down; one above it does not; and the
 * dollar has nothing to say about either, because pinning a reference pins it
 * to a cell and it is the cell that has moved.
 *
 * A reference to a row that was deleted is `#REF!`, which is what Excel puts
 * there and the only honest answer: the cell it named is gone.
 */
export function adjustFormula(text: string, change: BandChange, place?: FormulaPlace): string {
  if (change.by === 0) return text

  return mapReferences(text, (reference, on) => {
    if (!concerns(on, place)) return written(reference)

    const index = change.axis === 'row' ? reference.row : reference.column
    if (index < change.at) return written(reference)

    // Inside the band that was taken away: the cell this named no longer
    // exists, and pretending it is the one that moved into its place would be
    // an answer about a different cell.
    if (change.by < 0 && index < change.at - change.by) return '#REF!'

    const moved = index + change.by
    const limit = change.axis === 'row' ? LAST_ROW : 16_384
    if (moved < 0 || moved >= limit) return '#REF!'

    return written(
      change.axis === 'row' ? { ...reference, row: moved } : { ...reference, column: moved },
    )
  })
}

/** A reference as it is written, dollars and all. */
const written = (reference: FoundReference): string =>
  (reference.columnFixed ? '$' : '') +
  indexToColumn(reference.column) +
  (reference.rowFixed ? '$' : '') +
  String(reference.row + 1)

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

  return written({ ...reference, row, column })
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
