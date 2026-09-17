import { act, renderHook, waitFor } from '@testing-library/react'
import { EditorContext, useCurrentEditor, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { isMac } from '@orangery/platform'
import { CommandKeymap } from './keymap'
import { registerBuiltinCommands } from './definitions'
import { useCommand } from './use-command'

function Wrapper({ children }: { children: ReactNode }) {
  const editor = useEditor({
    extensions: [StarterKit, CommandKeymap],
    content: '<p>hello</p>',
  })
  const value = useMemo(() => ({ editor }), [editor])
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}

describe('useCommand', () => {
  beforeEach(registerBuiltinCommands)

  it('exposes the registry label and a platform-formatted shortcut', async () => {
    const { result } = renderHook(() => useCommand('edit.undo'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.command).toBeDefined()
    })
    expect(result.current.label).toBe('Undo')
    expect(result.current.shortcut).toBe(isMac ? '⌘Z' : 'Ctrl+z')
  })

  it('reports undo as disabled until the document changes, then undoes it', async () => {
    const { result } = renderHook(
      () => ({ undo: useCommand('edit.undo'), editor: useCurrentEditor().editor }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.editor).not.toBeNull()
    })
    // A selection-only change is not an undoable step, so the history is still empty.
    expect(result.current.undo.isEnabled).toBe(false)

    act(() => {
      result.current.editor?.commands.insertContentAt(1, 'typed ')
    })
    await waitFor(() => {
      expect(result.current.undo.isEnabled).toBe(true)
    })
    expect(result.current.editor?.getText()).toBe('typed hello')

    act(() => {
      result.current.undo.run()
    })
    await waitFor(() => {
      expect(result.current.editor?.getText()).toBe('hello')
    })
  })

  it('falls back to the id when a command is not registered', async () => {
    const { result } = renderHook(() => useCommand('nope.missing'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.label).toBe('nope.missing')
    })
    expect(result.current.command).toBeUndefined()
    expect(result.current.isEnabled).toBe(false)
  })
})
