import { useViewStore } from '../../../store/view-store'
import { selectWholeDocument } from '../selection'
import type { Command } from '@orangery/ui-kit'

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
  {
    id: 'edit.track-changes',
    label: 'Track Changes',
    group: 'edit',
    // No shortcut: the one Word uses for this is already centre alignment here,
    // and a mode switched on once a document is worth a menu trip.
    keywords: ['revision', 'review', 'record'],
    run: ({ editor }) => {
      const { trackChanges, setTrackChanges } = useViewStore.getState()
      setTrackChanges(!trackChanges)
      // The plugin reads the store on each change; an empty transaction gets
      // the menu's tick and the toolbar to notice at once.
      editor.view.dispatch(editor.state.tr)
    },
    isActive: () => useViewStore.getState().trackChanges,
  },
]
