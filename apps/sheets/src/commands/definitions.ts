import { registerAll, resetRegistry } from '@orangery/ui-kit'
import type { Command } from '@orangery/ui-kit'
import { isTauri } from '@orangery/platform'
import {
  newWorkbookFile,
  openWorkbookFromDialog,
  saveWorkbook,
  pickPicture,
  saveWorkbookAs,
} from '../document/file'
import { canRedo, canUndo } from '../document/history'
import { printSheet } from '../document/print'
import { exportOds, exportSheet } from '../document/file'
import {
  chartFromSelection,
  pictureAtCursor,
  tableFromSelection,
  totalsRowHere,
  recalculateWorkbook,
  useWorkbookStore,
} from '../store/workbook-store'
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
    id: 'file.exportOds',
    label: 'Export as OpenDocument…',
    group: 'file',
    keywords: ['ods', 'opendocument', 'libreoffice', 'export'],
    isEnabled: hasWorkbook,
    run: () => {
      void exportOds()
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
    id: 'format.cells',
    label: 'Number Format…',
    group: 'edit',
    shortcut: 'Mod+1',
    keywords: ['format', 'cells', 'custom', 'currency', 'date'],
    isEnabled: hasWorkbook,
    run: () => {
      window.dispatchEvent(new Event('orangery:format-cells'))
    },
  },
  {
    id: 'edit.link',
    label: 'Link…',
    group: 'edit',
    shortcut: 'Mod+K',
    keywords: ['hyperlink', 'url', 'address'],
    isEnabled: hasWorkbook,
    run: () => {
      window.dispatchEvent(new Event('orangery:link'))
    },
  },
  {
    id: 'edit.find',
    label: 'Find and Replace…',
    group: 'edit',
    shortcut: 'Mod+F',
    keywords: ['search', 'replace'],
    isEnabled: hasWorkbook,
    run: () => {
      // The strip belongs to the window, which is listening; a command knows
      // nothing about what is on screen.
      window.dispatchEvent(new Event('orangery:find'))
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
    id: 'data.sortRange',
    label: 'Sort Range…',
    group: 'edit',
    keywords: ['order', 'custom', 'columns', 'levels'],
    isEnabled: hasWorkbook,
    run: () => {
      // The dialog belongs to the window rather than to the command, which
      // knows nothing about what is on screen; the window is listening.
      window.dispatchEvent(new Event('orangery:sort-range'))
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

/** The sheet on screen, for a command that asks about how it is being looked at. */
const sheetNow = () => {
  const { open, current } = useWorkbookStore.getState()
  return open === null ? undefined : sheetsNow()[current]
}

export const viewCommands: readonly Command[] = [
  {
    id: 'view.freeze',
    label: 'Freeze at Cursor',
    group: 'view',
    keywords: ['panes', 'header', 'lock', 'unfreeze'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().freeze()
    },
  },
  {
    id: 'view.zoomIn',
    label: 'Zoom In',
    group: 'view',
    shortcut: 'Mod+=',
    isEnabled: hasWorkbook,
    run: () => {
      const { zoom } = useWorkbookStore.getState()
      zoom((sheetNow()?.sheet.view.zoom ?? 100) + 10)
    },
  },
  {
    id: 'view.zoomOut',
    label: 'Zoom Out',
    group: 'view',
    shortcut: 'Mod+-',
    isEnabled: hasWorkbook,
    run: () => {
      const { zoom } = useWorkbookStore.getState()
      zoom((sheetNow()?.sheet.view.zoom ?? 100) - 10)
    },
  },
  {
    id: 'view.zoomReset',
    label: 'Actual Size',
    group: 'view',
    shortcut: 'Mod+0',
    keywords: ['zoom', '100'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().zoom(100)
    },
  },
  {
    id: 'file.print',
    label: 'Print…',
    group: 'file',
    shortcut: 'Mod+P',
    keywords: ['pdf', 'export', 'paper'],
    isEnabled: hasWorkbook,
    run: () => {
      // The same dialog gives a PDF on macOS, which is the export: a
      // renderer of our own would print something other than what is here.
      const { open, current } = useWorkbookStore.getState()
      const sheet = open === null ? undefined : visibleSheets(open)[current]
      if (sheet !== undefined) printSheet(sheet.sheet.page)
    },
  },
  {
    id: 'format.rules',
    label: 'Conditional Formatting…',
    group: 'format',
    keywords: ['highlight', 'colour', 'color', 'rule'],
    isEnabled: hasWorkbook,
    run: () => {
      window.dispatchEvent(new Event('orangery:rules'))
    },
  },
  {
    id: 'data.names',
    label: 'Defined Names…',
    group: 'view',
    keywords: ['name', 'range', 'named'],
    isEnabled: hasWorkbook,
    run: () => {
      window.dispatchEvent(new Event('orangery:defined-names'))
    },
  },
  {
    id: 'data.goalSeek',
    label: 'Goal Seek…',
    group: 'view',
    keywords: ['what if', 'solve', 'backwards', 'target'],
    isEnabled: hasWorkbook,
    run: () => {
      window.dispatchEvent(new Event('orangery:goal-seek'))
    },
  },
  {
    id: 'view.recalculate',
    label: 'Recalculate',
    group: 'view',
    shortcut: 'F9',
    keywords: ['formula', 'calculate', 'refresh'],
    isEnabled: hasWorkbook,
    run: () => {
      // What somebody asks for when they have stopped trusting what is on
      // screen — so it starts from the values as they were typed rather than
      // from another pass over the same suspicion.
      void recalculateWorkbook()
    },
  },
  {
    id: 'view.gridlines',
    label: 'Show Gridlines',
    group: 'view',
    keywords: ['grid', 'lines', 'hide'],
    isEnabled: hasWorkbook,
    run: () => {
      useWorkbookStore.getState().toggleGridlines()
    },
  },
]

/**
 * A chart from what is selected.
 *
 * Five commands rather than one with a menu, because the palette is where
 * people look for them and a palette entry called "Chart…" that opens another
 * list is two searches for one thing.
 */
export const chartCommands: readonly Command[] = (
  [
    ['bar', 'Column Chart'],
    ['line', 'Line Chart'],
    ['pie', 'Pie Chart'],
    ['area', 'Area Chart'],
    ['scatter', 'Scatter Chart'],
  ] as const
).map(([kind, label]) => ({
  id: `insert.chart.${kind}`,
  label,
  group: 'insert' as const,
  keywords: ['chart', 'graph', 'plot', 'data'],
  isEnabled: hasWorkbook,
  run: () => {
    chartFromSelection(kind)
  },
}))

export const tableCommands: readonly Command[] = [
  {
    id: 'insert.table',
    label: 'Table',
    group: 'insert',
    keywords: ['format as table', 'list', 'range'],
    isEnabled: hasWorkbook,
    run: () => {
      tableFromSelection()
    },
  },
  {
    id: 'insert.table.totals',
    label: 'Total Row',
    group: 'insert',
    keywords: ['table', 'sum', 'subtotal'],
    isEnabled: hasWorkbook,
    run: () => {
      totalsRowHere()
    },
  },
]

export const pictureCommands: readonly Command[] = [
  {
    id: 'insert.picture',
    label: 'Picture…',
    group: 'insert',
    keywords: ['image', 'photo', 'logo'],
    isEnabled: hasWorkbook,
    run: () => {
      void (async () => {
        const file = await pickPicture()
        if (file !== null) pictureAtCursor(file)
      })()
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
  registerAll(chartCommands)
  registerAll(pictureCommands)
  registerAll(tableCommands)
  registerAll(fileCommands)
  registerAll(editCommands)
  registerAll(dataCommands)
  registerAll(structureCommands)
  registerAll(viewCommands)
  registerAll(sheetCommands)
}
