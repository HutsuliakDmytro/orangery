import { putCell } from '@orangery/ooxml-spreadsheet'
import type { AutoFilter, CellRange, ColumnRange, RowProperties } from '@orangery/ooxml-spreadsheet'
import type { GridSelection } from '@orangery/grid'
import type { CellChange } from './edit'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * What can be taken back.
 *
 * A step is one thing somebody did, however many cells it touched. Typing into
 * a cell is a step; pasting a hundred thousand of them is also a step, and a
 * history that recorded it as a hundred thousand would be a history nobody can
 * get out of. That is the whole of what "transactional" means here, and it is
 * why the unit is a list of changes rather than a change.
 *
 * Each change carries what something was and what it became, so the two
 * directions are the same walk with a different field read. Nothing is
 * recomputed on the way back: undo restores what was there rather than
 * re-running the edit backwards, which would mean the edit had to be
 * invertible, which is a promise a formula engine will not keep.
 *
 * Not everything a person does to a sheet is a change to a cell. A column's
 * width, a row's height, whether either is hidden — none of them live in a
 * cell, and a history that only knew cells would take back the last thing
 * typed when somebody meant to take back a drag. So a change is one of three
 * things, and the ones that are not cells are whole-list snapshots: a sheet
 * has a handful of column runs, and keeping both versions of the handful is
 * cheaper than describing the difference.
 *
 * What is not undone is the style entries an edit added to the workbook.
 * Typing `15%` can append an `<xf>`, and undoing leaves it there, unused. That
 * is what Excel does too: an unreferenced entry is legal, costs a line, and
 * removing it would renumber every entry after it — which would silently
 * restyle cells that had nothing to do with the edit.
 */

/** One thing that changed, in whichever part of the workbook keeps it. */
export type Change =
  | { kind: 'cell'; cell: CellChange }
  | { kind: 'columns'; sheet: string; before: ColumnRange[]; after: ColumnRange[] }
  | { kind: 'merges'; sheet: string; before: CellRange[]; after: CellRange[] }
  | { kind: 'filter'; sheet: string; before: AutoFilter | null; after: AutoFilter | null }
  | {
      kind: 'row'
      sheet: string
      index: number
      before: RowProperties | null
      after: RowProperties | null
    }

/** Cell changes as changes, which is what everything that makes them hands over. */
export const cellChanges = (changes: readonly CellChange[]): Change[] =>
  changes.map((cell) => ({ kind: 'cell', cell }))

export interface Step {
  changes: Change[]
  /**
   * Where the cursor was when the step began.
   *
   * Undo puts it back. Landing somewhere else after an undo is how a person
   * loses their place in a sheet they were halfway through.
   */
  selection: GridSelection
}

export interface History {
  past: Step[]
  future: Step[]
}

/**
 * How many steps are kept.
 *
 * Excel keeps a hundred; so does this, for the same reason. A step can hold a
 * hundred thousand cells, and an unbounded history of those is a window that
 * runs out of memory for having been used all afternoon.
 */
const DEPTH = 100

export const emptyHistory = (): History => ({ past: [], future: [] })

/**
 * Remembers a step, and forgets the future.
 *
 * Doing something new after undoing abandons what was undone, which every
 * editor does and everybody expects: there is one past and it is the one you
 * are in.
 */
export function recorded(history: History, step: Step): History {
  if (step.changes.length === 0) return history

  return { past: [...history.past, step].slice(-DEPTH), future: [] }
}

export const canUndo = (history: History): boolean => history.past.length > 0
export const canRedo = (history: History): boolean => history.future.length > 0

export interface Moved {
  history: History
  /** Where to put the cursor, or null when nothing moved. */
  selection: GridSelection | null
  /** The parts whose cells changed, so the window knows what to redraw. */
  sheets: Set<string>
}

const unchanged = (history: History): Moved => ({
  history,
  selection: null,
  sheets: new Set(),
})

export function undo(open: OpenWorkbook, history: History): Moved {
  const step = history.past[history.past.length - 1]
  if (step === undefined) return unchanged(history)

  // Backwards, so that two changes to the same cell in one step come out in
  // the order that leaves the earlier one standing.
  for (const change of [...step.changes].reverse()) put(open, change, 'before')

  return {
    history: { past: history.past.slice(0, -1), future: [...history.future, step] },
    selection: step.selection,
    sheets: sheetsOf(step),
  }
}

export function redo(open: OpenWorkbook, history: History): Moved {
  const step = history.future[history.future.length - 1]
  if (step === undefined) return unchanged(history)

  for (const change of step.changes) put(open, change, 'after')

  return {
    history: { past: [...history.past, step], future: history.future.slice(0, -1) },
    selection: step.selection,
    sheets: sheetsOf(step),
  }
}

/** The parts a step touched, so only those are redrawn. */
const sheetsOf = (step: Step): Set<string> =>
  new Set(step.changes.map((change) => (change.kind === 'cell' ? change.cell.sheet : change.sheet)))

function put(open: OpenWorkbook, change: Change, to: 'before' | 'after'): void {
  const path = change.kind === 'cell' ? change.cell.sheet : change.sheet
  const sheet = open.sheets.find((one) => one.path === path)
  // A step naming a sheet the workbook no longer has is one belonging to a
  // file that has since been closed; there is nothing to put it back into.
  if (sheet === undefined) return

  restore(sheet, change, to)
}

/** Puts one change back the way it found things, or forward again. */
function restore(sheet: OpenSheet, change: Change, to: 'before' | 'after'): void {
  if (change.kind === 'columns') {
    sheet.sheet.columns = change[to]
    return
  }

  if (change.kind === 'merges') {
    sheet.sheet.merges = change[to]
    return
  }

  if (change.kind === 'filter') {
    sheet.sheet.autoFilter = change[to]
    return
  }

  if (change.kind === 'row') {
    const row = change[to]
    if (row === null) sheet.cells.properties.delete(change.index)
    else sheet.cells.properties.set(change.index, row)
    return
  }

  const cell = change.cell[to]
  if (cell === null) sheet.cells.rows.get(change.cell.row)?.delete(change.cell.column)
  else putCell(sheet.cells, cell)
}
