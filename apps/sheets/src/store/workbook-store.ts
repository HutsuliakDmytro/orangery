import { create } from 'zustand'
import { boundsOf, singleCell } from '@orangery/grid'
import type { CellAddress, GridRange, GridSelection } from '@orangery/grid'
import type { BandChange, FilterCriteria, LookChange } from '@orangery/ooxml-spreadsheet'
import {
  blockFrom,
  copiedFrom,
  copiedRange,
  pasteBlock,
  pastedArea,
  readClipboard,
  writeClipboard,
} from '../document/clipboard'
import type { PasteOptions } from '../document/clipboard'
import { applyEdit, applyLook, clearCells } from '../document/edit'
import { fillCells } from '../document/fill'
import { findAll, nextAfter, replaceAll, replaceIn } from '../document/find'
import { freezeAt, showGridlines, unfreeze, zoomTo } from '../document/view'
import type { SearchOptions } from '../document/find'
import {
  addSheet,
  colorTab,
  hideSheet,
  indexOfSheet,
  moveSheet,
  removeSheet,
  renameSheet,
} from '../document/sheets'
import { merge, reshape, resizeColumns, resizeRows, unmerge } from '../document/structure'
import { columnNamesIn, looksLikeHeader, sortRows, tableToSort } from '../document/sort'
import type { SortKey } from '../document/sort'
import { filterColumn, toggleFilter } from '../document/filter'
import { shownText } from '../document/shown'
import { cellChanges, emptyHistory, recorded, redo, undo } from '../document/history'
import type { History } from '../document/history'
import { openWorkbook, visibleSheets } from '../document/workbook'
import type { OpenSheet, OpenWorkbook } from '../document/workbook'

/**
 * The workbook the window is showing.
 *
 * The package and the cells live here rather than in module state — unlike the
 * document apps, where the bytes are held aside because nothing renders them.
 * Here the cells *are* what is rendered, and a store is what tells the window
 * they changed.
 */

export interface WorkbookState {
  open: OpenWorkbook | null
  path: string | null
  /** Which of the visible sheets is showing. */
  current: number
  /**
   * What is selected on that sheet.
   *
   * Kept here rather than inside the grid because the name box is outside it,
   * and both have to mean the same thing. It starts again at the first cell on
   * every sheet, as a workbook does when it is opened.
   */
  selection: GridSelection
  /**
   * Whether anything has been typed since the file was opened or saved.
   *
   * What decides the fate of `calcChain`, and what a "you have unsaved
   * changes" will ask when there is one to ask.
   */
  edited: boolean
  /** What can be taken back, and what can be put back after that. */
  history: History
  /** What went wrong the last time something was opened, for the banner. */
  problem: string | null
  /**
   * Something worth saying that is not a failure.
   *
   * A workbook with macros in it, for one: they are kept and they are not
   * run, and somebody who does not know that would think the file was broken
   * rather than that this program is not Excel.
   */
  notice: string | null
  /**
   * The editing session, which the autosave is keyed by.
   *
   * Not the path: a workbook that was never saved has none, and one saved
   * under a new name would leave its old snapshot behind to be offered as
   * recoverable at every launch.
   */
  session: string
  busy: boolean
  load: (bytes: Uint8Array, path: string | null) => Promise<void>
  fail: (problem: string) => void
  dismiss: () => void
  close: () => void
  select: (index: number) => void
  /**
   * The tabs along the bottom.
   *
   * None of these can be taken back, as in Excel: a history step that could
   * undo a deleted sheet would have to hold a whole worksheet — its cells,
   * its drawings, the parts they point at — where every other step holds a
   * few cells. Being asked first is what takes the place of undo, and the
   * window does the asking.
   *
   * A sheet is named by its part rather than by its position. A tab has two
   * positions — among the sheets a person can see and among all of them — and
   * a hidden sheet has only the second, so the part is the only name that
   * means one thing everywhere.
   */
  addSheet: (options?: { duplicate?: boolean }) => void
  removeSheet: (path: string) => void
  renameSheet: (path: string, name: string) => void
  /** Moved to where the sheet at `before` is now, counting the visible ones. */
  moveSheet: (path: string, before: number) => void
  hideSheet: (path: string, hidden: boolean) => void
  colorTab: (path: string, color: string | null) => void
  choose: (selection: GridSelection) => void
  edit: (address: CellAddress, text: string) => void
  /** Empties everything selected, as one thing that can be taken back. */
  clear: () => void
  /** Puts one value into everything selected, likewise. */
  fill: (text: string) => void
  /** Changes how everything selected looks, likewise. */
  format: (look: LookChange) => void
  /**
   * Drags the corner of a selection out, and fills what it passed over.
   *
   * One step in the history however many cells it touched, because what
   * somebody did was drag a handle once.
   */
  fillSeries: (from: GridRange, to: GridRange) => void
  /** Puts rows or columns in where the selection is, or takes them out. */
  reshape: (axis: BandChange['axis'], insert: boolean) => void
  /** How wide a column is, or how tall a row; null for the sheet's own. */
  resize: (axis: BandChange['axis'], from: number, to: number, size: number | null) => void
  /** Hides what is selected, or brings it back. */
  hide: (axis: BandChange['axis'], hidden: boolean) => void
  /** Draws what is selected as one cell, or gives the cells back. */
  merge: (join: boolean) => void
  /** Puts the rows of the table under the cursor in order of one column. */
  sort: (ascending: boolean) => void
  /**
   * Puts them in order of several columns at once, and says so plainly.
   *
   * The one-column sort above is the button on the toolbar; this is the
   * dialog, where somebody has said which columns, which way round, in what
   * order, and whether the top row is names.
   */
  sortWith: (keys: readonly SortKey[], header: boolean) => void
  /** Turns the filter arrows on over the table under the cursor, or off. */
  toggleFilter: () => void
  /** What one filtered column keeps; null lets everything through again. */
  filterBy: (column: number, criteria: FilterCriteria | null) => void
  /**
   * Moves the cursor to the next thing that matches, and says where it is.
   *
   * The count comes back with it because what somebody wants to know while
   * searching is how many there are and which one they are on — and the
   * search has just worked both out.
   */
  findNext: (
    term: string,
    options: SearchOptions,
    backwards?: boolean,
  ) => { at: number; of: number }
  /** Replaces what the cursor is on, if it matches, and moves to the next. */
  replaceOne: (term: string, replacement: string, options: SearchOptions) => void
  /** Replaces every match as one step, and says how many that was. */
  replaceEverywhere: (term: string, replacement: string, options: SearchOptions) => number
  /**
   * How the sheet is looked at, which is not what it says.
   *
   * None of these are in the history. Nobody expects undo to take back a
   * zoom, and Excel does not offer it either: a view is where somebody is
   * standing rather than what they have written.
   */
  freeze: () => void
  zoom: (percent: number) => void
  toggleGridlines: () => void
  copy: () => Promise<void>
  cut: () => Promise<void>
  /**
   * Puts the clipboard down. Without options it is the ordinary paste.
   *
   * Values, formats and a transpose are the same operation with a different
   * answer to what arrives, which is why they are options rather than three
   * actions that would each have to record their own step.
   */
  paste: (options?: PasteOptions) => Promise<void>
  undo: () => void
  redo: () => void
  /** A workbook that has just been written, and now belongs to that path. */
  saved: (path: string) => void
}

export const useWorkbookStore = create<WorkbookState>((set) => ({
  open: null,
  path: null,
  current: 0,
  selection: singleCell({ row: 0, column: 0 }),
  edited: false,
  history: emptyHistory(),
  problem: null,
  notice: null,
  session: newSession(),
  busy: false,

  load: async (bytes, path) => {
    set({ busy: true })
    const open = await openWorkbook(bytes)
    const sheets = visibleSheets(open)

    // The sheet the workbook was left on, as far as it is one a person can
    // see: a file can be saved with a hidden sheet active.
    const active = Math.min(Math.max(open.workbook.activeSheet, 0), Math.max(sheets.length - 1, 0))
    set({
      open,
      path,
      current: active,
      selection: singleCell({ row: 0, column: 0 }),
      edited: false,
      history: emptyHistory(),
      problem: null,
      notice: noticeFor(open),
      session: newSession(),
      busy: false,
    })
  },

  fail: (problem) => {
    // The workbook that was open stays open: a file that would not open is a
    // reason to say so, not a reason to take away the one being worked on.
    set({ problem, busy: false })
  },

  dismiss: () => {
    set({ problem: null, notice: null })
  },

  close: () => {
    set({
      open: null,
      path: null,
      current: 0,
      selection: singleCell({ row: 0, column: 0 }),
      edited: false,
      history: emptyHistory(),
      problem: null,
      notice: null,
      session: newSession(),
      busy: false,
    })
  },

  select: (index) => {
    // A selection belongs to the sheet it was made on; carrying it across
    // would put the cursor on a cell nobody chose.
    set({ current: index, selection: singleCell({ row: 0, column: 0 }) })
  },

  addSheet: (options) => {
    const { open, current } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    const at = sheet === undefined ? open.sheets.length : indexOfSheet(open, sheet.path) + 1

    const added = addSheet(open, {
      at,
      ...(options?.duplicate === true && sheet !== undefined
        ? { copyOf: sheet, name: `${sheet.name} (2)` }
        : {}),
    })
    if (added === null) return

    const made = open.sheets[added]
    set({
      open: { ...open, sheets: [...open.sheets] },
      edited: true,
      current: made === undefined ? current : visibleSheets(open).indexOf(made),
      selection: singleCell({ row: 0, column: 0 }),
    })
  },

  removeSheet: (path) => {
    const { open, current } = useWorkbookStore.getState()
    if (open === null) return

    if (!removeSheet(open, indexOfSheet(open, path))) return

    set({
      open: { ...open, sheets: [...open.sheets] },
      edited: true,
      // Whichever sheet is now where that one was, or the last if it was last.
      current: Math.min(current, Math.max(visibleSheets(open).length - 1, 0)),
      selection: singleCell({ row: 0, column: 0 }),
    })
  },

  renameSheet: (path, name) => {
    const { open } = useWorkbookStore.getState()
    if (open === null) return

    if (renameSheet(open, indexOfSheet(open, path), name) === null) return

    set({ open: { ...open, sheets: [...open.sheets] }, edited: true })
  },

  moveSheet: (path, before) => {
    const { open } = useWorkbookStore.getState()
    if (open === null) return

    const shown = visibleSheets(open)
    const sheet = shown.find((one) => one.path === path)
    const target = shown[before]
    if (sheet === undefined || target === undefined) return

    if (!moveSheet(open, indexOfSheet(open, path), indexOfSheet(open, target.path))) return

    set({
      open: { ...open, sheets: [...open.sheets] },
      edited: true,
      current: visibleSheets(open).indexOf(sheet),
    })
  },

  hideSheet: (path, hidden) => {
    const { open, current } = useWorkbookStore.getState()
    if (open === null) return

    if (!hideSheet(open, indexOfSheet(open, path), hidden)) return

    set({
      open: { ...open, sheets: [...open.sheets] },
      edited: true,
      current: Math.min(current, Math.max(visibleSheets(open).length - 1, 0)),
    })
  },

  colorTab: (path, color) => {
    const { open } = useWorkbookStore.getState()
    if (open === null) return

    if (!colorTab(open, indexOfSheet(open, path), color)) return

    set({ open: { ...open, sheets: [...open.sheets] }, edited: true })
  },

  choose: (selection) => {
    set({ selection })
  },

  saved: (path) => {
    set({ path, edited: false, problem: null })
  },

  edit: (address, text) => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const change = applyEdit(open, sheet, address, text)
    if (change === null) return

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes: cellChanges([change]), selection }),
    })
  },

  clear: () => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const changes = clearCells(sheet, selectedCells(selection))
    if (changes.length === 0) return

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes: cellChanges(changes), selection }),
    })
  },

  fillSeries: (from, to) => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const bounds = boundsOf(from)
    const reach = boundsOf(to)
    const changes = fillCells(open, sheet, {
      from: bounds,
      to: { row: reach.bottom, column: reach.right },
    })
    if (changes.length === 0) return

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes: cellChanges(changes), selection }),
      // What was filled is what is selected afterwards, the whole of it: the
      // cells that were dragged and the cells they were dragged over.
      selection: {
        ranges: [
          {
            anchor: { row: bounds.top, column: bounds.left },
            focus: {
              row: Math.max(reach.bottom, bounds.bottom),
              column: Math.max(reach.right, bounds.right),
            },
          },
        ],
        active: { row: bounds.top, column: bounds.left },
      },
    })
  },

  fill: (text) => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const changes = selectedCells(selection)
      .map((address) => applyEdit(open, sheet, address, text))
      .filter((change): change is NonNullable<typeof change> => change !== null)
    if (changes.length === 0) return

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes: cellChanges(changes), selection }),
    })
  },

  format: (look) => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const changes = applyLook(open, sheet, selectedCells(selection), look)
    if (changes.length === 0) return

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes: cellChanges(changes), selection }),
    })
  },

  reshape: (axis, insert) => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    // As many as are selected: choosing three rows and asking for an
    // insertion puts three in, which is what every spreadsheet does.
    const bounds = selection.ranges.map((range) => boundsOf(range))
    const from = Math.min(...bounds.map((one) => (axis === 'row' ? one.top : one.left)))
    const to = Math.max(...bounds.map((one) => (axis === 'row' ? one.bottom : one.right)))
    const span = to - from + 1

    const changes = reshape(sheet, { axis, at: from, by: insert ? span : -span })
    if (changes.length === 0) return

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes, selection }),
    })
  },

  resize: (axis, from, to, size) => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const changes =
      axis === 'column'
        ? resizeColumns(sheet, from, to, { width: size, custom: size !== null })
        : resizeRows(sheet, from, to, { height: size, customHeight: size !== null })

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes, selection }),
    })
  },

  hide: (axis, hidden) => {
    const { open, current, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const bounds = selection.ranges.map((range) => boundsOf(range))
    const from = Math.min(...bounds.map((one) => (axis === 'row' ? one.top : one.left)))
    const to = Math.max(...bounds.map((one) => (axis === 'row' ? one.bottom : one.right)))

    const changes =
      axis === 'column'
        ? resizeColumns(sheet, from, to, { hidden })
        : resizeRows(sheet, from, to, { hidden })

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(useWorkbookStore.getState().history, { changes, selection }),
    })
  },

  merge: (join) => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const last = selection.ranges[selection.ranges.length - 1]
    const bounds = boundsOf(last ?? { anchor: selection.active, focus: selection.active })
    const range = {
      sheet: null,
      from: { row: bounds.top, column: bounds.left },
      to: { row: bounds.bottom, column: bounds.right },
    }

    const changes = join ? merge(sheet, range) : unmerge(sheet, range)
    if (changes.length === 0) return

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes, selection }),
    })
  },

  sort: (ascending) => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const last = selection.ranges[selection.ranges.length - 1]
    const bounds = boundsOf(last ?? { anchor: selection.active, focus: selection.active })
    const range = tableToSort(sheet, bounds, selection.active)

    const changes = sortRows(
      open,
      sheet,
      range,
      [{ column: selection.active.column, ascending }],
      looksLikeHeader(open, sheet, range),
    )
    if (changes.length === 0) return

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes, selection }),
    })
  },

  sortWith: (keys, header) => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const last = selection.ranges[selection.ranges.length - 1]
    const bounds = boundsOf(last ?? { anchor: selection.active, focus: selection.active })

    const changes = sortRows(
      open,
      sheet,
      tableToSort(sheet, bounds, selection.active),
      keys,
      header,
    )
    if (changes.length === 0) return

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes, selection }),
    })
  },

  toggleFilter: () => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const changes = toggleFilter(open, sheet, selection.active)
    if (changes.length === 0) return

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes, selection }),
    })
  },

  filterBy: (column, criteria) => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const changes = filterColumn(open, sheet, column, criteria)
    if (changes.length === 0) return

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes, selection }),
    })
  },

  freeze: () => {
    const { open, current, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    // The same command both ways: a sheet that is frozen unfreezes, and one
    // that is not freezes at the cursor.
    const done =
      sheet.sheet.view.panes === null
        ? freezeAt(open, sheet, selection.active)
        : unfreeze(open, sheet)
    if (!done) return

    set({ open: { ...open, sheets: [...open.sheets] }, edited: true })
  },

  zoom: (percent) => {
    const { open, current } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined || !zoomTo(open, sheet, percent)) return

    set({ open: { ...open, sheets: [...open.sheets] }, edited: true })
  },

  toggleGridlines: () => {
    const { open, current } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return
    if (!showGridlines(open, sheet, !sheet.sheet.view.showGridLines)) return

    set({ open: { ...open, sheets: [...open.sheets] }, edited: true })
  },

  findNext: (term, options, backwards = false) => {
    const { open, current, selection } = useWorkbookStore.getState()
    if (open === null) return { at: 0, of: 0 }

    const shown = visibleSheets(open)
    const sheet = shown[current]
    if (sheet === undefined) return { at: 0, of: 0 }

    const looking = options.everywhere ? shown : [sheet]
    const found = findAll(open, looking, term, options)
    if (found.length === 0) return { at: 0, of: 0 }

    const next = nextAfter(
      found,
      { sheet: sheet.path, row: selection.active.row, column: selection.active.column },
      backwards,
    )
    if (next === null) return { at: 0, of: found.length }

    const landed = shown.findIndex((one) => one.path === next.sheet)
    const cell = { row: next.row, column: next.column }

    set({
      ...(landed >= 0 && landed !== current ? { current: landed } : {}),
      selection: singleCell(cell),
    })

    return {
      at: found.findIndex((one) => one === next) + 1,
      of: found.length,
    }
  },

  replaceOne: (term, replacement, options) => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const change = replaceIn(open, sheet, selection.active, term, replacement, options)
    if (change !== null) {
      set({
        open: redrawn(open, [sheet.path]),
        edited: true,
        history: recorded(history, { changes: cellChanges([change]), selection }),
      })
    }

    // On to the next either way: a cell that did not match is one the cursor
    // was parked on, and stopping there would be a button that does nothing.
    useWorkbookStore.getState().findNext(term, options)
  },

  replaceEverywhere: (term, replacement, options) => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return 0

    const shown = visibleSheets(open)
    const sheet = shown[current]
    if (sheet === undefined) return 0

    const changes = replaceAll(
      open,
      options.everywhere ? shown : [sheet],
      term,
      replacement,
      options,
    )
    if (changes.length === 0) return 0

    set({
      open: redrawn(open, new Set(changes.map((one) => one.sheet))),
      edited: true,
      history: recorded(history, { changes: cellChanges(changes), selection }),
    })

    return changes.length
  },

  copy: async () => {
    const { open, current, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    await writeClipboard(copiedFrom(sheet, selection, (cell) => shownText(open, cell)))
  },

  cut: async () => {
    // Copy first: a cut that emptied the cells and then failed to reach the
    // clipboard would be a delete nobody asked for.
    await useWorkbookStore.getState().copy()
    useWorkbookStore.getState().clear()
  },

  paste: async (options) => {
    const { open, current, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    const at = copiedRange(selection)
    const block = blockFrom(await readClipboard(), { row: at.row, column: at.column })
    if (block === null) return

    // The rectangle somebody selected, so a block that goes into it a whole
    // number of times is laid down that many times.
    const over = {
      rows: at.to.row - at.row + 1,
      columns: at.to.column - at.column + 1,
    }
    const how: PasteOptions = { what: 'all', transpose: false, ...options, over }

    const changes = pasteBlock(sheet, block, { row: at.row, column: at.column }, how)
    if (changes.length === 0) return

    const area = pastedArea(block, how)

    // Read again rather than above: reading the clipboard is a wait, and a
    // step recorded against the history as it was before the wait would lose
    // whatever happened during it.
    const history = useWorkbookStore.getState().history

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes: cellChanges(changes), selection }),
      // What was pasted is what is selected afterwards, as every spreadsheet
      // does: it is the thing somebody is about to format or move.
      selection: {
        ranges: [
          {
            anchor: { row: at.row, column: at.column },
            focus: { row: at.row + area.rows - 1, column: at.column + area.columns - 1 },
          },
        ],
        active: { row: at.row, column: at.column },
      },
    })
  },

  undo: () => {
    const { open, history } = useWorkbookStore.getState()
    if (open === null) return

    const moved = undo(open, history)
    if (moved.selection === null) return

    set({
      open: redrawn(open, moved.sheets),
      history: moved.history,
      selection: moved.selection,
      edited: true,
    })
  },

  redo: () => {
    const { open, history } = useWorkbookStore.getState()
    if (open === null) return

    const moved = redo(open, history)
    if (moved.selection === null) return

    set({
      open: redrawn(open, moved.sheets),
      history: moved.history,
      selection: moved.selection,
      edited: true,
    })
  },
}))

/**
 * Every cell of every range, once.
 *
 * `Mod`-clicking a cell that is already selected puts it in two ranges, and
 * acting on it twice would make the second change record what the first one
 * left rather than what was there to begin with — which undo would then put
 * back wrong.
 */
function selectedCells(selection: GridSelection): CellAddress[] {
  const seen = new Set<number>()
  const cells: CellAddress[] = []

  for (const range of selection.ranges) {
    const bounds = boundsOf(range)
    for (let row = bounds.top; row <= bounds.bottom; row += 1) {
      for (let column = bounds.left; column <= bounds.right; column += 1) {
        const key = row * 16_384 + column
        if (seen.has(key)) continue

        seen.add(key)
        cells.push({ row, column })
      }
    }
  }

  return cells
}

/**
 * The workbook, with the sheets that changed handed over in new wrappers.
 *
 * A sparse map of a million cells is not copied to change one string, but
 * something has to tell the window that what it is holding is no longer what
 * it drew. Shallow copies of the sheet and of the workbook around it cost
 * three objects and say exactly that.
 */
function redrawn(open: OpenWorkbook, paths: Iterable<string>): OpenWorkbook {
  const changed = new Set(paths)

  return {
    ...open,
    sheets: open.sheets.map((one) =>
      changed.has(one.path) ? { ...one, cells: { ...one.cells } } : one,
    ),
  }
}

export const visibleSheetsOf = (open: OpenWorkbook): OpenSheet[] => visibleSheets(open)

/**
 * A name for one editing session, which nothing else will collide with.
 *
 * A declaration rather than a const, because the store is built at module load
 * and reaches for this while doing it.
 */
function newSession(): string {
  return `${String(Date.now())}-${Math.random().toString(36).slice(2)}`
}

/**
 * What is worth saying about a workbook that has just been opened.
 *
 * Macros are the one thing so far. They are kept byte for byte and they are
 * never run, and a person who did not know that would think the file had come
 * out broken rather than that this is not Excel.
 */
function noticeFor(open: OpenWorkbook): string | null {
  return open.pkg.parts.has('xl/vbaProject.bin')
    ? 'This workbook contains macros. They are kept when you save, and they are not run.'
    : null
}

/**
 * The table a sort dialog should be asking about.
 *
 * Worked out here rather than in the dialog because it is the same question
 * the sort itself asks, and two answers to it would be two different tables
 * — one shown and one sorted.
 */
export function sortTarget(): { columns: string[]; header: boolean; left: number } | null {
  const { open, current, selection } = useWorkbookStore.getState()
  if (open === null) return null

  const sheet = visibleSheets(open)[current]
  if (sheet === undefined) return null

  const last = selection.ranges[selection.ranges.length - 1]
  const bounds = boundsOf(last ?? { anchor: selection.active, focus: selection.active })
  const range = tableToSort(sheet, bounds, selection.active)
  const header = looksLikeHeader(open, sheet, range)

  return {
    columns: columnNamesIn(open, sheet, range, header),
    header,
    left: Math.min(range.from.column, range.to.column),
  }
}
