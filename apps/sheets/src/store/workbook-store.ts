import { create } from 'zustand'
import { singleCell } from '@orangery/grid'
import type { GridSelection } from '@orangery/grid'
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
  /** What went wrong the last time something was opened, for the banner. */
  problem: string | null
  busy: boolean
  load: (bytes: Uint8Array, path: string | null) => Promise<void>
  fail: (problem: string) => void
  dismiss: () => void
  close: () => void
  select: (index: number) => void
  choose: (selection: GridSelection) => void
  /** A workbook that has just been written, and now belongs to that path. */
  saved: (path: string) => void
}

export const useWorkbookStore = create<WorkbookState>((set) => ({
  open: null,
  path: null,
  current: 0,
  selection: singleCell({ row: 0, column: 0 }),
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
    set({ path, problem: null })
  },
}))

export const visibleSheetsOf = (open: OpenWorkbook): OpenSheet[] => visibleSheets(open)
