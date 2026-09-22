import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@orangery/platform'
import { formatReference, putCell } from '@orangery/ooxml-spreadsheet'
import type { Cell, CellType } from '@orangery/ooxml-spreadsheet'
import { rowsFilteredBy } from './filter'
import type { Change } from './history'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * Keeping the numbers on screen in step with the formulas behind them.
 *
 * The engine is Rust (`crates/formula`) and is a pure library: it is handed
 * cells and asked for values, and it has never heard of a file or a window.
 * This is the other half of that decision — the only place in the app that
 * knows both the workbook on screen and the one in memory.
 *
 * Three rules shape everything here.
 *
 * The file's numbers are trusted until somebody types. A workbook was written
 * by a program that worked its formulas out, and recalculating two hundred
 * thousand cells to arrive at the same answers would be a slow way to open a
 * file. So opening loads the cells without working anything out, and the
 * first edit is what sets the graph walking.
 *
 * Only what changed comes back. One keystroke in a workbook of a million
 * formulas touches a handful of cells, and the window repaints those.
 *
 * And a formula the engine cannot read is left exactly as the file wrote it.
 * A workbook that uses something unimplemented must not become a workbook
 * this program has damaged.
 */

/** A value, in the shapes that survive the trip to Rust and back. */
export type Held =
  | { kind: 'number'; number: number }
  | { kind: 'text'; text: string }
  | { kind: 'boolean'; boolean: boolean }
  | { kind: 'error'; text: string }
  | { kind: 'blank' }

/** A cell as the engine is told about one. */
export interface CellInput {
  row: number
  column: number
  /** Without the leading `=`; absent for a cell somebody typed a value into. */
  formula?: string
  value: Held
}

/** A formula somebody has given a name to. */
export interface NameInput {
  name: string
  formula: string
}

/** A table, as the engine is told about one. */
export interface TableInput {
  name: string
  sheet: string
  top: number
  bottom: number
  left: number
  right: number
  headerRows: number
  totalsRows: number
  columns: string[]
}

export interface SheetInput {
  sheet: string
  cells: CellInput[]
  /** Rows a filter put out of sight, and rows somebody hid by hand. */
  filtered: number[]
  hidden: number[]
}

export interface Outcome {
  sheet: string
  row: number
  column: number
  value: Held
  /**
   * The formula this came from, when it was not this cell's own.
   *
   * A cell nobody typed in has appeared, because a formula somewhere else
   * gave an answer too big to fit in its own cell.
   */
  spilledFrom: Place | null
  /** Whether a spill has let this cell go, and it is empty again. */
  emptied: boolean
}

export interface Place {
  sheet: string
  row: number
  column: number
}

/** What a change came to, as the engine reports it. */
export interface Report {
  cells: Outcome[]
  /** Cells that depend on themselves; Excel warns and leaves them at nought. */
  circular: Place[]
  /** Why a formula was refused, when it was. */
  refused: string | null
}

const nothing: Report = { cells: [], circular: [], refused: null }

/**
 * The formula somebody typed, without its `=`.
 *
 * A lone `=` is not one: it is somebody who has begun and stopped, and
 * storing it as a formula would mean storing something with nothing in it.
 */
export function typedFormula(text: string): string | null {
  if (!text.startsWith('=')) return null

  const body = text.slice(1).trim()
  return body === '' ? null : text.slice(1)
}

/** What a cell holds, as a value the engine understands. */
export function heldOf(open: OpenWorkbook, cell: Cell | null): Held {
  if (cell === null || cell.value === null) return { kind: 'blank' }

  if (cell.type === 's') {
    return { kind: 'text', text: open.strings[Number(cell.value)]?.text ?? '' }
  }
  if (cell.type === 'inlineStr' || cell.type === 'str') return { kind: 'text', text: cell.value }
  if (cell.type === 'b') return { kind: 'boolean', boolean: cell.value === '1' }
  if (cell.type === 'e') return { kind: 'error', text: cell.value }

  const number = Number(cell.value)
  return Number.isFinite(number) ? { kind: 'number', number } : { kind: 'text', text: cell.value }
}

/**
 * What a cell becomes when the engine has worked it out.
 *
 * A formula that comes to nothing shows nought, which is what Excel shows for
 * `=A1` over an empty A1: the cell it points at is empty, and the sum of
 * nothing is nought. Anywhere else in this program a blank stays a blank —
 * here it is the answer to a question somebody asked.
 */
export function shownAs(value: Held): { type: CellType; value: string } {
  switch (value.kind) {
    case 'number':
      return { type: 'n', value: String(value.number) }
    // `str` rather than `inlineStr`: a formula's text result is what the file
    // calls a string result, and it is written back as one.
    case 'text':
      return { type: 'str', value: value.text }
    case 'boolean':
      return { type: 'b', value: value.boolean ? '1' : '0' }
    case 'error':
      return { type: 'e', value: value.text }
    case 'blank':
      return { type: 'n', value: '0' }
  }
}

/**
 * Every cell of a workbook, as the engine is told about them on open.
 *
 * Named by the sheet's name rather than by its part. Everywhere else in this
 * app a sheet is its path, because a name can change and a part cannot — but
 * a formula says `Sheet2!A1`, and the engine has to find the sheet the
 * formula names. Renaming is what keeps the two in step, and it is rare
 * enough to be worth a reload.
 */
export function cellsOf(open: OpenWorkbook): SheetInput[] {
  return open.sheets.map((sheet) => ({
    sheet: sheet.name,
    cells: inputsOf(open, sheet),
    ...outOfSight(open, sheet),
  }))
}

/**
 * Which rows cannot be seen, and why.
 *
 * Two lists rather than one, because `SUBTOTAL` can tell them apart and the
 * sheet cannot: a row's `hidden` flag says it is out of sight and not why,
 * which is all the file records. 9 leaves out what a filter hid; 109 leaves
 * out what somebody hid by hand as well. Asking the filter again is the only
 * way to know which rows belong in which list.
 */
export function outOfSight(
  open: OpenWorkbook,
  sheet: OpenSheet,
): { filtered: number[]; hidden: number[] } {
  const filtered = rowsFilteredBy(open, sheet)
  const byFilter = new Set(filtered)
  const hidden: number[] = []

  for (const [row, properties] of sheet.cells.properties) {
    if (properties.hidden && !byFilter.has(row)) hidden.push(row)
  }

  return { filtered, hidden }
}

/**
 * Every table of the workbook, named by the sheet it sits on.
 *
 * Of the workbook rather than of a sheet, because a formula on one sheet can
 * name a table on another and a table's name is the workbook's own.
 */
export function tablesOf(open: OpenWorkbook): TableInput[] {
  return open.sheets.flatMap((sheet) =>
    sheet.tables.map((table) => ({
      name: table.name,
      sheet: sheet.name,
      top: Math.min(table.range.from.row, table.range.to.row),
      bottom: Math.max(table.range.from.row, table.range.to.row),
      left: Math.min(table.range.from.column, table.range.to.column),
      right: Math.max(table.range.from.column, table.range.to.column),
      headerRows: table.headerRows,
      totalsRows: table.totalsRows,
      columns: table.columns.map((column) => column.name),
    })),
  )
}

/**
 * The defined names of a workbook, as the engine is told about them.
 *
 * The hidden ones are left out: Excel writes `_xlnm.Print_Area` and its kind
 * as names, and they are settings rather than something a formula would ever
 * say. A name local to one sheet is sent as it is — the engine matches by
 * name, and a local name that shadows a workbook one is rare enough to be
 * worth getting wrong loudly rather than guessing at quietly.
 */
export function namesOf(open: OpenWorkbook): NameInput[] {
  return open.workbook.definedNames
    .filter((defined) => !defined.hidden && !defined.name.startsWith('_xlnm.'))
    .map((defined) => ({ name: defined.name, formula: defined.formula }))
}

/** The name a formula would use for the sheet kept in that part. */
function nameOfPart(open: OpenWorkbook, path: string): string | null {
  return open.sheets.find((one) => one.path === path)?.name ?? null
}

function inputsOf(open: OpenWorkbook, sheet: OpenSheet): CellInput[] {
  const cells: CellInput[] = []

  for (const row of sheet.cells.rows.values()) {
    for (const cell of row.values()) {
      const input: CellInput = { row: cell.row, column: cell.column, value: heldOf(open, cell) }
      const formula = ownFormula(cell)
      if (formula !== null) input.formula = formula
      cells.push(input)
    }
  }

  return cells
}

/**
 * The formula a cell works out for itself, if it is the one working it out.
 *
 * The cells under an array formula all carry its text — the reader gives it
 * to them so that anything above can ask a cell what its formula is — but
 * only the corner cell computes it. Handing the text to the engine for every
 * covered cell would set twenty cells all computing the same answer and all
 * trying to spill it over each other, and the sheet would fill with
 * `#SPILL!`. What those cells hold is the value the corner put there.
 */
export function ownFormula(cell: Cell): string | null {
  if (cell.formula === null) return null
  if (cell.formula.kind === 'array' && cell.formula.ref === null) return null

  return cell.formula.text
}

/**
 * The cells a step of history touched, told to the engine.
 *
 * Which way round depends on which way the history is being walked: undo puts
 * back what a cell was, redo puts back what it became, and the engine has to
 * be told the same thing the sheet was told.
 */
export function inputsFor(
  open: OpenWorkbook,
  changes: readonly Change[],
  direction: 'before' | 'after',
): Placed[] {
  const wanted: Placed[] = []

  for (const change of changes) {
    // Column widths, row heights, merges and filters change what a sheet
    // looks like rather than what it comes to.
    if (change.kind !== 'cell') continue

    const name = nameOfPart(open, change.cell.sheet)
    if (name === null) continue

    const cell = direction === 'before' ? change.cell.before : change.cell.after
    const where = { sheet: name, row: change.cell.row, column: change.cell.column }

    if (cell === null) {
      wanted.push(where)
      continue
    }

    wanted.push({
      ...where,
      input: {
        row: cell.row,
        column: cell.column,
        value: heldOf(open, cell),
        ...(ownFormula(cell) === null ? {} : { formula: ownFormula(cell) as string }),
      },
    })
  }

  return wanted
}

/**
 * Writes what the engine worked out into the cells that hold the formulas.
 *
 * The formula stays; only what it comes to is replaced. A cell whose text the
 * engine has never been given is left alone — it belongs to a sheet this
 * report is not about.
 *
 * Hands back the sheets that have to be redrawn, which is what the store does
 * with it.
 */
export function applyReport(open: OpenWorkbook, report: Report): string[] {
  const touched = new Set<string>()
  const spills = new Map<string, Spill>()

  for (const outcome of report.cells) {
    const sheet = open.sheets.find((one) => one.name === outcome.sheet)
    if (sheet === undefined) continue

    const existing = sheet.cells.rows.get(outcome.row)?.get(outcome.column) ?? null

    // A spill that has let a cell go takes the cell with it. Leaving an
    // empty one behind would leave the file with a `<c>` nobody put there.
    if (outcome.emptied) {
      if (existing === null) continue
      sheet.cells.rows.get(outcome.row)?.delete(outcome.column)
      touched.add(sheet.path)
      continue
    }

    const { type, value } = shownAs(outcome.value)

    if (outcome.spilledFrom !== null) {
      spilled(sheet, outcome, outcome.spilledFrom, { type, value }, spills)
      touched.add(sheet.path)
      continue
    }

    // A cell with nothing in it is not made to hold a nought: the engine
    // reports the cell that was typed into as well as the ones that follow
    // from it, and the typed one has already been written.
    if (existing === null) continue
    if (existing.type === type && existing.value === value) continue

    putCell(sheet.cells, { ...existing, type, value })
    touched.add(sheet.path)
  }

  // The file has one way of saying "this formula covers that rectangle", and
  // it is the array formula Excel has written since 1993: the corner carries
  // `<f t="array" ref="A1:A5">` and every other cell carries only its cached
  // value. A dynamic array is written the same way, which is why a workbook
  // full of them opens in a spreadsheet that has never heard of one.
  for (const spill of spills.values()) {
    const anchor = spill.sheet.cells.rows.get(spill.row)?.get(spill.column) ?? null
    if (anchor?.formula == null) continue

    const ref = `${formatReference({ row: spill.row, column: spill.column })}:${formatReference({
      row: spill.bottom,
      column: spill.right,
    })}`

    putCell(spill.sheet.cells, {
      ...anchor,
      formula: { ...anchor.formula, kind: 'array', ref },
    })
    touched.add(spill.sheet.path)
  }

  return [...touched]
}

/** A formula's answer, and how far across the sheet it reached. */
interface Spill {
  sheet: OpenSheet
  row: number
  column: number
  bottom: number
  right: number
}

/**
 * One cell of somebody else's answer, written where it landed.
 *
 * It carries the formula's text with no `ref` of its own, which is what the
 * cells under an array formula do: the corner speaks for all of them, and a
 * reader that opens the file again gives them the text back.
 */
function spilled(
  sheet: OpenSheet,
  outcome: Outcome,
  from: Place,
  held: { type: CellType; value: string },
  spills: Map<string, Spill>,
): void {
  const anchorCell = sheet.cells.rows.get(from.row)?.get(from.column) ?? null
  const existing = sheet.cells.rows.get(outcome.row)?.get(outcome.column) ?? null

  putCell(sheet.cells, {
    row: outcome.row,
    column: outcome.column,
    type: held.type,
    value: held.value,
    // Whatever look the cell already had is kept: a spill lands on a sheet
    // somebody has formatted, and a column of dates should stay dates.
    style: existing?.style ?? null,
    formula:
      anchorCell?.formula == null
        ? null
        : { text: anchorCell.formula.text, kind: 'array', shared: null, ref: null, carried: null },
    rich: null,
    carried: existing?.carried ?? null,
  })

  const key = `${from.sheet}!${String(from.row)},${String(from.column)}`
  const spill = spills.get(key)

  if (spill === undefined) {
    spills.set(key, {
      sheet,
      row: from.row,
      column: from.column,
      bottom: outcome.row,
      right: outcome.column,
    })
    return
  }

  spill.bottom = Math.max(spill.bottom, outcome.row)
  spill.right = Math.max(spill.right, outcome.column)
}

/**
 * A serial number for right now, in the workbook's own date system.
 *
 * Worked out here rather than in Rust because the workbook's calendar is a
 * fact about the file, and because a library that read a clock could not be
 * asked the same question twice.
 */
export function moment(date1904: boolean): number {
  const now = new Date()
  const days = Math.floor(now.getTime() / 86_400_000)
  const fraction = (now.getTime() % 86_400_000) / 86_400_000
  const offset = now.getTimezoneOffset() / (24 * 60)

  // 25569 days from 1970 back to the 1900 system's own beginning, and 1462
  // fewer for the workbook Excel for Mac wrote before 2011.
  return days + 25_569 - (date1904 ? 1462 : 0) + fraction - offset
}

export async function openEngine(book: string, open: OpenWorkbook): Promise<void> {
  if (!isTauri()) return

  await invoke('formula_open', {
    book,
    workbook: {
      sheets: cellsOf(open),
      tables: tablesOf(open),
      names: namesOf(open),
      moment: moment(open.workbook.date1904),
      date1904: open.workbook.date1904,
      // The seed is the session's, so the same workbook recalculated twice
      // in one sitting does not invent a different column of random numbers.
      seed: Math.floor(Math.random() * 2 ** 32) + 1,
      manual: open.workbook.manualCalculation,
    },
  })
}

/**
 * Whether the workbook works itself out as it is typed into.
 *
 * The engine is told because it is the engine that stops: on manual, an edit
 * is worked out only as far as the cell it was made in, and the rest of the
 * sheet keeps the numbers it had until a recalculation is asked for.
 */
export async function calculateManually(book: string, manual: boolean): Promise<void> {
  if (!isTauri()) return
  await invoke('formula_calculation', { book, manual })
}

export async function closeEngine(book: string): Promise<void> {
  if (!isTauri()) return
  await invoke('formula_close', { book })
}

/** A cell as it is named when many of them go over at once. */
export interface Placed {
  sheet: string
  row: number
  column: number
  /** Absent for a cell that was emptied. */
  input?: CellInput
}

/**
 * Many cells at once, worked out once at the end.
 *
 * A paste of a hundred thousand cells is one call rather than a hundred
 * thousand, and one walk of the dependency graph rather than a hundred
 * thousand walks over ground the next one covers again.
 */
export async function setCells(book: string, cells: Placed[]): Promise<Report> {
  if (!isTauri() || cells.length === 0) return nothing
  return await invoke<Report>('formula_set_many', { book, cells })
}

export async function setCell(
  book: string,
  sheet: string,
  row: number,
  column: number,
  input: CellInput,
): Promise<Report> {
  if (!isTauri()) return nothing
  return await invoke<Report>('formula_set', { book, sheet, row, column, input })
}

export async function clearCell(
  book: string,
  sheet: string,
  row: number,
  column: number,
): Promise<Report> {
  if (!isTauri()) return nothing
  return await invoke<Report>('formula_clear', { book, sheet, row, column })
}

/**
 * The engine told which rows are out of sight on one sheet.
 *
 * Only the totals are worked out again, because nothing else on a sheet
 * cares whether a row is hidden — so filtering a table of a hundred thousand
 * rows recalculates the handful of cells that are about it.
 */
export async function sendOutOfSight(
  book: string,
  open: OpenWorkbook,
  sheet: OpenSheet,
): Promise<Report> {
  if (!isTauri()) return nothing

  return await invoke<Report>('formula_out_of_sight', {
    book,
    sheet: sheet.name,
    ...outOfSight(open, sheet),
  })
}

/** What a Goal Seek came to. */
export interface Sought {
  /** The value the changing cell needed, or null when none was found. */
  value: number | null
  report: Report
}

/**
 * The value one cell needs for another to come out at a number.
 *
 * There is no running a spreadsheet backwards, so the engine does it by
 * trying: it sets the cell, recalculates, and uses the distance from the
 * wanted number to guess again.
 */
export async function goalSeek(
  book: string,
  sheet: string,
  target: Place,
  wanted: number,
  changing: Place,
): Promise<Sought> {
  if (!isTauri()) return { value: null, report: nothing }

  return await invoke<Sought>('formula_goal_seek', { book, sheet, target, wanted, changing })
}

export async function recalculate(book: string, date1904: boolean): Promise<Report> {
  if (!isTauri()) return nothing
  return await invoke<Report>('formula_recalculate', { book, moment: moment(date1904) })
}
