import { EditorContext, useEditor } from '@tiptap/react'
import { useEffect, useMemo } from 'react'
import { CommandSourceProvider } from '@orangery/ui-kit'
import { useViewStore } from '../store/view-store'
import type { CommandSource } from '@orangery/ui-kit'
import { registerBuiltinCommands } from './commands/definitions'
import { buildExtensions, setCurrentEditor } from './extension-set'

// Registration happens once at module load: the registry is process-wide state,
// and `registerBuiltinCommands` resets first so HMR cannot double-register.
registerBuiltinCommands()

/**
 * Owns the Tiptap instance and publishes it through Tiptap's `EditorContext`,
 * so toolbar, menus and the command palette reach it via `useCommand`.
 */
export function EditorProvider({ children }: { children: React.ReactNode }) {
  const editor = useEditor({
    extensions: buildExtensions(),
    content: '<p></p>',
    editorProps: {
      attributes: {
        class: 'editor-surface',
        spellcheck: 'false',
      },
    },
  })

  // Paste and drop handlers live in an extension, which is built before the
  // editor exists; they reach it through this registration.
  useEffect(() => {
    setCurrentEditor(editor)
    return () => {
      setCurrentEditor(null)
    }
  }, [editor])

  const value = useMemo(() => ({ editor }), [editor])

  /**
   * What the chrome runs commands against, and when to ask again.
   *
   * The registry is app-agnostic, so the app supplies both halves. Subscribing
   * per surface rather than re-rendering everything on each transaction is what
   * keeps a 200-page document responsive: each button recomputes only its own
   * two booleans and ignores every change that does not move them.
   */
  const source = useMemo<CommandSource>(
    () => ({
      read: () => (editor ? { editor } : null),
      subscribe: (listener) => {
        // The view store first, and whether or not there is an editor: a
        // command can be a toggle on something the document carries rather
        // than on the selection — tracked changes, numbered headings — and the
        // menu bar has to follow those too.
        const unsubscribe = useViewStore.subscribe(listener)
        if (!editor) return unsubscribe

        // Selection moves without a transaction, and focus decides whether an
        // edit command applies at all.
        editor.on('transaction', listener)
        editor.on('selectionUpdate', listener)
        editor.on('focus', listener)
        editor.on('blur', listener)

        return () => {
          unsubscribe()
          editor.off('transaction', listener)
          editor.off('selectionUpdate', listener)
          editor.off('focus', listener)
          editor.off('blur', listener)
        }
      },
    }),
    [editor],
  )

  return (
    <EditorContext.Provider value={value}>
      <CommandSourceProvider source={source}>{children}</CommandSourceProvider>
    </EditorContext.Provider>
  )
}
