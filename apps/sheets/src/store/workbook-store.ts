import { create } from 'zustand'
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
  load: (bytes: Uint8Array, path: string | null) => Promise<void>
  close: () => void
  select: (index: number) => void
}

export const useWorkbookStore = create<WorkbookState>((set) => ({
  open: null,
  path: null,
  current: 0,

  load: async (bytes, path) => {
    const open = await openWorkbook(bytes)
    const sheets = visibleSheets(open)

    // The sheet the workbook was left on, as far as it is one a person can
    // see: a file can be saved with a hidden sheet active.
    const active = Math.min(Math.max(open.workbook.activeSheet, 0), Math.max(sheets.length - 1, 0))
    set({ open, path, current: active })
  },

  close: () => {
    set({ open: null, path: null, current: 0 })
  },

  select: (index) => {
    set({ current: index })
  },
}))

export const visibleSheetsOf = (open: OpenWorkbook): OpenSheet[] => visibleSheets(open)
