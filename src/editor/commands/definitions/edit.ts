import { selectWholeDocument } from '../selection'
import type { Command } from '../types'

/**
 * History commands. StarterKit provides the ProseMirror history plugin; the
 * registry owns how the action is labelled, keyed and enabled.
 */
export const editCommands: readonly Command[] = [
  {
    id: 'edit.undo',
    label: 'Undo',
    group: 'edit',
    shortcut: 'Mod+z',
    keywords: ['revert', 'back'],
    run: ({ editor }) => void editor.chain().focus().undo().run(),
    isEnabled: ({ editor }) => editor.can().undo(),
  },
  {
    id: 'edit.redo',
    label: 'Redo',
    group: 'edit',
    shortcut: 'Mod+Shift+z',
    keywords: ['forward', 'again'],
    run: ({ editor }) => void editor.chain().focus().redo().run(),
    isEnabled: ({ editor }) => editor.can().redo(),
  },
  {
    id: 'edit.select-all',
    label: 'Select All',
    group: 'edit',
    shortcut: 'Mod+a',
    run: ({ editor }) => {
      // Deliberately not `selectAll()`: see `selection.ts` for why an
      // AllSelection breaks every block-level command that follows.
      selectWholeDocument(editor)
    },
  },
  {
    id: 'edit.accept-revisions',
    label: 'Accept Tracked Changes',
    group: 'edit',
    keywords: ['revision', 'review', 'track changes'],
    run: ({ editor }) => {
      // The selection when there is one, the whole document when there is not:
      // reviewing is usually a sweep, and settling one change is the exception.
      editor.chain().focus().acceptRevisions(editor.state.selection.empty).run()
    },
  },
  {
    id: 'edit.reject-revisions',
    label: 'Reject Tracked Changes',
    group: 'edit',
    keywords: ['revision', 'review', 'track changes', 'undo'],
    run: ({ editor }) => {
      editor.chain().focus().rejectRevisions(editor.state.selection.empty).run()
    },
  },
]
