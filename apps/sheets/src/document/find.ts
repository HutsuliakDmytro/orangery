import { putCell } from '@orangery/ooxml-spreadsheet'
import type { Cell } from '@orangery/ooxml-spreadsheet'
import { applyEdit } from './edit'
import type { CellChange } from './edit'
import { shownText } from './shown'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * Finding something, and putting something else in its place.
 *
 * Two decisions decide everything else. What is being searched — what a cell
 * shows, or what it holds — and how much of it has to match. A search of
 * values finds `1,234.50` in a cell holding 1234.5, and a search of formulas
 * finds `B2` in a cell showing a number; both are what somebody means,
 * depending on which they asked for, and neither can stand in for the other.
 *
 * Replacing goes through the same reader typing does, so what lands in a cell
 * after a replace is what would have landed there had somebody typed it. A
 * replace that wrote strings back would turn a column of numbers into a
 * column of words that look like numbers.
 */

export interface SearchOptions {
  /** What to look at: what a cell shows, or the formula behind it. */
  within: 'values' | 'formulas'
  matchCase: boolean
  /** Whether the whole cell has to be the text, rather than holding it. */
  wholeCell: boolean
  /** Every sheet, rather than the one on screen. */
  everywhere: boolean
}

/** Where something was found. */
export interface Found {
  sheet: string
  row: number
  column: number
}

const looked = (text: string, options: SearchOptions): string =>
  options.matchCase ? text : text.toLocaleUpperCase()

/** Whether one cell's text matches. */
function matches(text: string, term: string, options: SearchOptions): boolean {
  const here = looked(text, options)
  const wanted = looked(term, options)

  return options.wholeCell ? here === wanted : here.includes(wanted)
}

/** The text a search reads out of a cell, or nothing where it has none. */
function textOf(
  open: OpenWorkbook,
  sheet: OpenSheet,
  at: { row: number; column: number },
  options: SearchOptions,
): string | null {
  const cell = sheet.cells.rows.get(at.row)?.get(at.column) ?? null
  if (cell === null) return null

  if (options.within === 'formulas') {
    // A cell without a formula still answers a formula search with its value,
    // as Excel does: the formula bar shows one or the other, and that is what
    // "look in formulas" means.
    return cell.formula === null ? (cell.value ?? '') : `=${cell.formula.text}`
  }

  return shownText(open, cell)
}

/**
 * Everything that matches, in the order somebody would walk it.
 *
 * Row by row and then column by column, which is the order Excel's Find Next
 * goes in and the order a person reads a sheet.
 */
export function findAll(
  open: OpenWorkbook,
  sheets: readonly OpenSheet[],
  term: string,
  options: SearchOptions,
): Found[] {
  if (term === '') return []

  const found: Found[] = []

  for (const sheet of sheets) {
    const rows = [...sheet.cells.rows.keys()].sort((a, b) => a - b)

    for (const row of rows) {
      const cells = sheet.cells.rows.get(row)
      if (cells === undefined) continue

      for (const column of [...cells.keys()].sort((a, b) => a - b)) {
        const text = textOf(open, sheet, { row, column }, options)
        if (text !== null && matches(text, term, options)) {
          found.push({ sheet: sheet.path, row, column })
        }
      }
    }
  }

  return found
}

/** The match after the one somebody is on, wrapping round the end. */
export function nextAfter(
  found: readonly Found[],
  at: { sheet: string; row: number; column: number } | null,
  backwards = false,
): Found | null {
  if (found.length === 0) return null
  if (at === null) return found[backwards ? found.length - 1 : 0] ?? null

  const index = found.findIndex(
    (one) => one.sheet === at.sheet && one.row === at.row && one.column === at.column,
  )

  if (index < 0) {
    // Not on a match: the next one after where the cursor is, in reading order.
    const after = found.findIndex(
      (one) =>
        one.sheet === at.sheet &&
        (one.row > at.row || (one.row === at.row && one.column > at.column)),
    )
    if (backwards) {
      const before = [...found].reverse().find((one) => one.sheet === at.sheet && one.row < at.row)
      return before ?? found[found.length - 1] ?? null
    }
    return (after < 0 ? found[0] : found[after]) ?? null
  }

  // Round the end rather than stopping at it, which is what Find Next does.
  const step = backwards ? -1 : 1
  return found[(index + step + found.length) % found.length] ?? null
}

/**
 * One cell with the text replaced, as a change.
 *
 * A value goes through the reader that typing uses, so `5` put in place of
 * `4` is a number and `4/5` is a date — the same answers somebody would have
 * got by typing them, which is the only set of answers that surprises nobody.
 *
 * A formula is different: what changes is the formula's text, and the value
 * the file remembers stays where it is until something recalculates. That is
 * what already happens when a sort or a paste moves a formula's references
 * (`sort.ts`), and it is the only honest answer until there is an engine —
 * writing the new formula in as text would turn a sum into a word.
 */
export function replaceIn(
  open: OpenWorkbook,
  sheet: OpenSheet,
  at: { row: number; column: number },
  term: string,
  replacement: string,
  options: SearchOptions,
): CellChange | null {
  const text = textOf(open, sheet, at, options)
  if (text === null || !matches(text, term, options)) return null

  const written = options.wholeCell
    ? replacement
    : replaceEvery(text, term, replacement, options.matchCase)

  const cell = sheet.cells.rows.get(at.row)?.get(at.column) ?? null

  if (options.within === 'formulas' && cell?.formula != null && written.startsWith('=')) {
    const after: Cell = {
      ...cell,
      formula: { ...cell.formula, text: written.slice(1) },
    }

    putCell(sheet.cells, after)
    return { sheet: sheet.path, row: at.row, column: at.column, before: cell, after }
  }

  return applyEdit(open, sheet, at, written)
}

/** Every occurrence, case folded or not, without a regular expression. */
function replaceEvery(text: string, term: string, replacement: string, matchCase: boolean): string {
  if (term === '') return text

  let out = ''
  let at = 0

  const here = matchCase ? text : text.toLocaleUpperCase()
  const wanted = matchCase ? term : term.toLocaleUpperCase()

  for (;;) {
    const found = here.indexOf(wanted, at)
    if (found < 0) return out + text.slice(at)

    out += text.slice(at, found) + replacement
    at = found + wanted.length
  }
}

/**
 * Every match replaced, as one thing that can be taken back.
 *
 * Counted rather than reported one at a time: what somebody wants to know
 * after Replace All is how many, and what they want to be able to do is undo
 * it in one go.
 */
export function replaceAll(
  open: OpenWorkbook,
  sheets: readonly OpenSheet[],
  term: string,
  replacement: string,
  options: SearchOptions,
): CellChange[] {
  const byPath = new Map(sheets.map((sheet) => [sheet.path, sheet]))
  const changes: CellChange[] = []

  for (const found of findAll(open, sheets, term, options)) {
    const sheet = byPath.get(found.sheet)
    if (sheet === undefined) continue

    const change = replaceIn(open, sheet, found, term, replacement, options)
    if (change !== null) changes.push(change)
  }

  return changes
}
