import { create } from 'zustand'
import { boundsOf, singleCell } from '@orangery/grid'
import type { CellAddress, GridSelection } from '@orangery/grid'
import { applyEdit, clearCells } from '../document/edit'
import { emptyHistory, recorded, redo, undo } from '../document/history'
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
  busy: boolean
  load: (bytes: Uint8Array, path: string | null) => Promise<void>
  fail: (problem: string) => void
  dismiss: () => void
  close: () => void
  select: (index: number) => void
  choose: (selection: GridSelection) => void
  edit: (address: CellAddress, text: string) => void
  /** Empties everything selected, as one thing that can be taken back. */
  clear: () => void
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
      busy: false,
    })
  },

  fail: (problem) => {
    // The workbook that was open stays open: a file that would not open is a
    // reason to say so, not a reason to take away the one being worked on.
    set({ problem, busy: false })
  },

  dismiss: () => {
    set({ problem: null })
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
      busy: false,
    })
  },

  select: (index) => {
    // A selection belongs to the sheet it was made on; carrying it across
    // would put the cursor on a cell nobody chose.
    set({ current: index, selection: singleCell({ row: 0, column: 0 }) })
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
      history: recorded(history, { changes: [change], selection }),
    })
  },

  clear: () => {
    const { open, current, history, selection } = useWorkbookStore.getState()
    if (open === null) return

    const sheet = visibleSheets(open)[current]
    if (sheet === undefined) return

    // Every cell of every range, once: `Mod`-clicking a cell that is already
    // selected would otherwise clear it twice, and the second change would
    // record an empty cell as what the first one found.
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

    const changes = clearCells(sheet, cells)
    if (changes.length === 0) return

    set({
      open: redrawn(open, [sheet.path]),
      edited: true,
      history: recorded(history, { changes, selection }),
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
