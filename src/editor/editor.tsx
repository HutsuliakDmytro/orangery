import { EditorContext, useEditor } from '@tiptap/react'
import { useEffect, useMemo } from 'react'
import { registerBuiltinCommands } from './commands'
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

  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}
