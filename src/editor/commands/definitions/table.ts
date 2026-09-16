import { requestPicker } from '../picker-store'
import type { Command } from '../types'

/**
 * Table editing.
 *
 * Every command is a no-op outside a table except "insert", so they are gated on
 * the cursor actually being in one — a greyed-out row of table buttons is more
 * informative than buttons that silently do nothing.
 */
const inTable = ({ editor }: { editor: { isActive: (name: string) => boolean } }): boolean =>
  editor.isActive('table')

export const tableCommands: readonly Command[] = [
  {
    id: 'insert.table',
    label: 'Table',
    group: 'insert',
    keywords: ['grid', 'rows', 'columns'],
    run: () => {
      requestPicker('table-grid')
    },
  },
  {
    id: 'table.borders',
    label: 'Table Borders…',
    group: 'insert',
    keywords: ['lines', 'grid', 'frame'],
    run: () => {
      requestPicker('table-borders')
    },
    isEnabled: inTable,
  },
  {
    id: 'table.cell-background',
    label: 'Cell Background…',
    group: 'insert',
    keywords: ['shading', 'fill', 'colour'],
    run: () => {
      requestPicker('cell-background')
    },
    isEnabled: inTable,
  },
  {
    id: 'table.row-above',
    label: 'Insert Row Above',
    group: 'insert',
    keywords: ['table row'],
    run: ({ editor }) => {
      editor.chain().focus().addRowBefore().run()
    },
    isEnabled: inTable,
  },
  {
    id: 'table.row-below',
    label: 'Insert Row Below',
    group: 'insert',
    keywords: ['table row'],
    run: ({ editor }) => {
      editor.chain().focus().addRowAfter().run()
    },
    isEnabled: inTable,
  },
  {
    id: 'table.column-left',
    label: 'Insert Column Left',
    group: 'insert',
    keywords: ['table column'],
    run: ({ editor }) => {
      editor.chain().focus().addColumnBefore().run()
    },
    isEnabled: inTable,
  },
  {
    id: 'table.column-right',
    label: 'Insert Column Right',
    group: 'insert',
    keywords: ['table column'],
    run: ({ editor }) => {
      editor.chain().focus().addColumnAfter().run()
    },
    isEnabled: inTable,
  },
  {
    id: 'table.delete-row',
    label: 'Delete Row',
    group: 'insert',
    keywords: ['remove table row'],
    run: ({ editor }) => {
      editor.chain().focus().deleteRow().run()
    },
    isEnabled: inTable,
  },
  {
    id: 'table.delete-column',
    label: 'Delete Column',
    group: 'insert',
    keywords: ['remove table column'],
    run: ({ editor }) => {
      editor.chain().focus().deleteColumn().run()
    },
    isEnabled: inTable,
  },
  {
    id: 'table.merge-cells',
    label: 'Merge Cells',
    group: 'insert',
    keywords: ['combine', 'span'],
    run: ({ editor }) => {
      editor.chain().focus().mergeCells().run()
    },
    isEnabled: ({ editor }) => editor.can().mergeCells(),
  },
  {
    id: 'table.split-cell',
    label: 'Split Cell',
    group: 'insert',
    keywords: ['unmerge', 'divide'],
    run: ({ editor }) => {
      editor.chain().focus().splitCell().run()
    },
    isEnabled: ({ editor }) => editor.can().splitCell(),
  },
  {
    id: 'table.delete',
    label: 'Delete Table',
    group: 'insert',
    keywords: ['remove table'],
    run: ({ editor }) => {
      editor.chain().focus().deleteTable().run()
    },
    isEnabled: inTable,
  },
]
