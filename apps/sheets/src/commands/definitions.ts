import { registerAll, resetRegistry } from '@orangery/ui-kit'
import type { Command } from '@orangery/ui-kit'
import { isTauri } from '@orangery/platform'
import { openWorkbookFromDialog, saveWorkbook } from '../document/file'
import { canRedo, canUndo } from '../document/history'
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

export const structureCommands: readonly Command[] = [
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
  registerAll(structureCommands)
  registerAll(sheetCommands)
}
