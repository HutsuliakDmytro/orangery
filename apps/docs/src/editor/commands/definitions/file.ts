import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@orangery/platform'
import { fileOperations } from '../file-actions'
import type { Command } from '@orangery/ui-kit'

/**
 * File menu. The actual work lives in `file-actions.ts` so these stay thin and
 * the registry keeps no state — see `docs/adr/0002-command-registry.md`.
 */
export const fileCommands: readonly Command[] = [
  {
    id: 'file.new',
    label: 'New',
    group: 'file',
    shortcut: 'Mod+n',
    keywords: ['create', 'blank'],
    run: ({ editor }) => {
      void fileOperations.newDocument(editor)
    },
  },
  {
    id: 'file.new-window',
    label: 'New Window',
    group: 'file',
    shortcut: 'Mod+Shift+n',
    keywords: ['window', 'second document'],
    run: () => {
      // One window holds one document, so a second document means a second window.
      if (isTauri()) void invoke('open_window', { path: null })
    },
  },
  {
    id: 'file.open',
    label: 'Open…',
    group: 'file',
    shortcut: 'Mod+o',
    keywords: ['load', 'browse'],
    run: ({ editor }) => {
      void fileOperations.open(editor)
    },
  },
  {
    id: 'file.save',
    label: 'Save',
    group: 'file',
    shortcut: 'Mod+s',
    keywords: ['write', 'store'],
    run: ({ editor }) => {
      void fileOperations.save(editor)
    },
  },
  {
    id: 'file.save-as',
    label: 'Save As…',
    group: 'file',
    shortcut: 'Mod+Shift+s',
    keywords: ['copy', 'duplicate', 'export'],
    run: ({ editor }) => {
      void fileOperations.saveAs(editor)
    },
  },
]
