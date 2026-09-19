import { registerAll, resetRegistry } from '@orangery/ui-kit'
import type { Command } from '@orangery/ui-kit'
import { isTauri } from '@orangery/platform'
import { openWorkbookFromDialog, saveWorkbook } from '../document/file'
import { useWorkbookStore } from '../store/workbook-store'
import { visibleSheets } from '../document/workbook'

/**
 * Every command the app has, in one registry.
 *
 * The menu, the palette and the keyboard all read from here, so a command
 * exists once and works from all three — the rule the other two apps follow
 * (`apps/docs/docs/adr/0002-command-registry.md`).
 *
 * What a reader can do is all there is so far: open a workbook, save it back,
 * close it, and move between its sheets. Editing brings its own commands with
 * it.
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
  registerAll(sheetCommands)
}
