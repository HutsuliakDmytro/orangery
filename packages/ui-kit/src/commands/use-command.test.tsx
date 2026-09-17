import { act, renderHook, waitFor } from '@testing-library/react'
import { EditorContext, useCurrentEditor, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import type { ReactNode } from 'react'
import { useMemo } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { isMac } from '@orangery/platform'
import { CommandKeymap } from './keymap'
import { register, resetRegistry } from './registry'
import { useCommand } from './use-command'

/**
 * The hook against commands registered here, not against an app's.
 *
 * What it owes its caller is the same either way: the registry's label, a
 * shortcut formatted for this platform, an enabled flag that follows the
 * editor, and a run that reaches the command. Testing that through a real
 * app's Undo would make the test fail for reasons that have nothing to do
 * with the hook.
 */

function Wrapper({ children }: { children: ReactNode }) {
  const editor = useEditor({
    extensions: [StarterKit, CommandKeymap],
    content: '<p>hello</p>',
  })
  const value = useMemo(() => ({ editor }), [editor])
  return <EditorContext.Provider value={value}>{children}</EditorContext.Provider>
}

let ran = 0

beforeEach(() => {
  resetRegistry()
  ran = 0

  register({
    id: 'test.shout',
    label: 'Shout',
    group: 'edit',
    shortcut: 'Mod+Z',
    run: () => {
      ran += 1
    },
  })

  register({
    id: 'test.needs-text',
    label: 'Needs text',
    group: 'edit',
    // Reads the editor on every call, which is what makes the flag follow it.
    isEnabled: ({ editor }) => editor.getText().length > 4,
    run: () => {},
  })
})

describe('useCommand', () => {
  it('exposes the registry label and a platform-formatted shortcut', async () => {
    const { result } = renderHook(() => useCommand('test.shout'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.command).toBeDefined()
    })
    expect(result.current.label).toBe('Shout')
    expect(result.current.shortcut).toBe(isMac ? '⌘Z' : 'Ctrl+Z')
  })

  it('runs the registered command', async () => {
    const { result } = renderHook(() => useCommand('test.shout'), { wrapper: Wrapper })

    await waitFor(() => {
      expect(result.current.command).toBeDefined()
    })
    act(() => {
      result.current.run()
    })

    expect(ran).toBe(1)
  })

  it('re-reads isEnabled as the document changes', async () => {
    const { result } = renderHook(
      () => ({ command: useCommand('test.needs-text'), editor: useCurrentEditor().editor }),
      { wrapper: Wrapper },
    )

    await waitFor(() => {
      expect(result.current.editor).not.toBeNull()
    })
    expect(result.current.command.isEnabled).toBe(true)

    act(() => {
      result.current.editor?.commands.setContent('<p>hi</p>')
    })
    await waitFor(() => {
      expect(result.current.command.isEnabled).toBe(false)
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
