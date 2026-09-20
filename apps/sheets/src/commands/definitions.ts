import { registerAll, resetRegistry } from '@orangery/ui-kit'
import type { Command } from '@orangery/ui-kit'
import { isTauri } from '@orangery/platform'
import {
  newWorkbookFile,
  openWorkbookFromDialog,
  saveWorkbook,
  saveWorkbookAs,
} from '../document/file'
import { canRedo, canUndo } from '../document/history'
import { exportSheet } from '../document/file'
import { useWorkbookStore } from '../store/workbook-store'
import { visibleSheets } from '../document/workbook'

/**
 * Every command the app has, in one registry.
 *
 * The menu, the palette and the keyboard all read from here, so a command
 * exists once and works from all three — the rule the other two apps follow
 * (`apps/docs/docs/adr/0002-command-registry.md`).
 *
 * Open a workbook, save it back, close it, move between its sheets, and take
 * back what was typed. The rest of editing brings its own commands with it.
 */

const hasWorkbook = () => useWorkbookStore.getState().open !== null

/** The sheets a person can reach, which is not all the file has. */
const sheetsNow = () => {
  const { open } = useWorkbookStore.getState()
  return open === null ? [] : visibleSheets(open)
}

export const fileCommands: readonly Command[] = [
  {
    id: 'file.new',
    label: 'New Workbook',
    group: 'file',
    shortcut: 'Mod+N',
    keywords: ['blank', 'empty'],
    run: () => {
      void newWorkbookFile()
    },
  },
  {
    id: 'file.open',
    label: 'Open…',
    group: 'file',
    shortcut: 'Mod+O',
    keywords: ['workbook', 'xlsx', 'spreadsheet'],
    // Without a shell there is no file dialog and no disk; a command that
    // cannot work is shown disabled rather than failing when it is chosen.
    isEnabled: () => isTauri(),
    run: () => {
      void openWorkbookFromDialog()
    },
  },
  {
    id: 'file.save',
    label: 'Save',
    group: 'file',
    shortcut: 'Mod+S',
    keywords: ['write', 'xlsx'],
    isEnabled: () => isTauri() && hasWorkbook(),
    run: () => {
      void saveWorkbook()
    },
  },
  {
    id: 'file.saveAs',
    label: 'Save As…',
    group: 'file',
    shortcut: 'Mod+Shift+S',
    keywords: ['copy', 'elsewhere'],
    isEnabled: () => isTauri() && hasWorkbook(),
    run: () => {
      void saveWorkbookAs()
    },
  },
  {
    id: 'file.importCsv',
    label: 'Import Text File…',
    group: 'file',
    keywords: ['csv', 'tsv', 'open'],
    isEnabled: () => isTauri(),
    run: () => {
      // The window owns the wizard, because the wizard is the window; the
      // command is only the door.
      window.dispatchEvent(new Event('orangery:import-csv'))
    },
  },
  {
    id: 'file.exportCsv',
    label: 'Export Sheet as CSV…',
    group: 'file',
    keywords: ['csv', 'save', 'text'],
    isEnabled: () => isTauri() && hasWorkbook(),
    run: () => {
      void exportSheet()
    },
  },
  {
    id: 'file.close',
    label: 'Close Workbook',
    group: 'file',
    shortcut: 'Mod+W',
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().close()
    },
  },
]

/** The history of the workbook on screen, or an empty one when there is none. */
const historyNow = () => useWorkbookStore.getState().history

export const editCommands: readonly Command[] = [
  {
    id: 'edit.cut',
    label: 'Cut',
    group: 'edit',
    shortcut: 'Mod+X',
    isEnabled: hasWorkbook,
    run: () => {
      void useWorkbookStore.getState().cut()
    },
  },
  {
    id: 'edit.copy',
    label: 'Copy',
    group: 'edit',
    shortcut: 'Mod+C',
    isEnabled: hasWorkbook,
    run: () => {
      void useWorkbookStore.getState().copy()
    },
  },
  {
    id: 'edit.paste',
    label: 'Paste',
    group: 'edit',
    shortcut: 'Mod+V',
    isEnabled: hasWorkbook,
    run: () => {
      void useWorkbookStore.getState().paste()
    },
  },
  {
    id: 'edit.pasteValues',
    label: 'Paste Values Only',
    group: 'edit',
    shortcut: 'Mod+Shift+V',
    keywords: ['special', 'numbers', 'freeze'],
    isEnabled: hasWorkbook,
    run: () => {
      void useWorkbookStore.getState().paste({ what: 'values', transpose: false })
    },
  },
  {
    id: 'edit.pasteFormats',
    label: 'Paste Formatting Only',
    group: 'edit',
    keywords: ['special', 'style', 'look'],
    isEnabled: hasWorkbook,
    run: () => {
      void useWorkbookStore.getState().paste({ what: 'formats', transpose: false })
    },
  },
  {
    id: 'edit.pasteTransposed',
    label: 'Paste Transposed',
    group: 'edit',
    keywords: ['special', 'turn', 'rotate', 'rows', 'columns'],
    isEnabled: hasWorkbook,
    run: () => {
      void useWorkbookStore.getState().paste({ what: 'all', transpose: true })
    },
  },
  {
    id: 'edit.undo',
    label: 'Undo',
    group: 'edit',
    shortcut: 'Mod+Z',
    keywords: ['revert', 'back'],
    isEnabled: () => hasWorkbook() && canUndo(historyNow()),
    run: () => {
      useWorkbookStore.getState().undo()
    },
  },
  {
    id: 'edit.redo',
    label: 'Redo',
    group: 'edit',
    shortcut: 'Mod+Shift+Z',
    keywords: ['again', 'forward'],
    isEnabled: () => hasWorkbook() && canRedo(historyNow()),
    run: () => {
      useWorkbookStore.getState().redo()
    },
  },
]

export const dataCommands: readonly Command[] = [
  {
    id: 'data.sortAscending',
    label: 'Sort A to Z',
    group: 'edit',
    keywords: ['order', 'ascending'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().sort(true)
    },
  },
  {
    id: 'data.sortDescending',
    label: 'Sort Z to A',
    group: 'edit',
    keywords: ['order', 'descending'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().sort(false)
    },
  },
]

export const structureCommands: readonly Command[] = [
  {
    id: 'data.filter',
    label: 'Filter',
    group: 'view',
    keywords: ['autofilter', 'arrows'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().toggleFilter()
    },
  },
  {
    id: 'sheet.insertRows',
    label: 'Insert Rows',
    group: 'insert',
    keywords: ['add', 'row'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().reshape('row', true)
    },
  },
  {
    id: 'sheet.insertColumns',
    label: 'Insert Columns',
    group: 'insert',
    keywords: ['add', 'column'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().reshape('column', true)
    },
  },
  {
    id: 'sheet.deleteRows',
    label: 'Delete Rows',
    group: 'edit',
    keywords: ['remove', 'row'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().reshape('row', false)
    },
  },
  {
    id: 'sheet.hideRows',
    label: 'Hide Rows',
    group: 'view',
    keywords: ['row'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().hide('row', true)
    },
  },
  {
    id: 'sheet.hideColumns',
    label: 'Hide Columns',
    group: 'view',
    keywords: ['column'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().hide('column', true)
    },
  },
  {
    id: 'sheet.showRows',
    label: 'Unhide Rows',
    group: 'view',
    keywords: ['row', 'show'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().hide('row', false)
    },
  },
  {
    id: 'sheet.showColumns',
    label: 'Unhide Columns',
    group: 'view',
    keywords: ['column', 'show'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().hide('column', false)
    },
  },
  {
    id: 'sheet.deleteColumns',
    label: 'Delete Columns',
    group: 'edit',
    keywords: ['remove', 'column'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().reshape('column', false)
    },
  },
]

export const sheetCommands: readonly Command[] = [
  {
    id: 'sheet.next',
    label: 'Next Sheet',
    group: 'view',
    shortcut: 'Mod+Alt+ArrowRight',
    keywords: ['tab'],
    isEnabled: () => sheetsNow().length > 1,
    run: () => {
      const { current, select } = useWorkbookStore.getState()
      select(Math.min(current + 1, sheetsNow().length - 1))
    },
  },
  {
    id: 'sheet.previous',
    label: 'Previous Sheet',
    group: 'view',
    shortcut: 'Mod+Alt+ArrowLeft',
    keywords: ['tab'],
    isEnabled: () => sheetsNow().length > 1,
    run: () => {
      const { current, select } = useWorkbookStore.getState()
      select(Math.max(current - 1, 0))
    },
  },
]

/**
 * Registers every command exactly once.
 *
 * The reset keeps hot reload and repeated test runs from tripping the
 * duplicate-id guard.
 */
export function registerBuiltinCommands(): void {
  resetRegistry()
  registerAll(fileCommands)
  registerAll(editCommands)
  registerAll(dataCommands)
  registerAll(structureCommands)
  registerAll(sheetCommands)
}
