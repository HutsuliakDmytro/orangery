import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { isMac } from '@orangery/platform'
import { register, resetRegistry } from './registry'
import { CommandSourceProvider } from './source-provider'
import type { CommandSource } from './source'
import { useCommand } from './use-command'

/**
 * The hook against a context this file declares, the way an app declares its
 * own. Nothing here is an editor or a deck: what the hook owes its caller is
 * the registry's label, a shortcut formatted for this platform, an enabled flag
 * that follows the source, and a run that reaches the command.
 */
declare module './types' {
  interface CommandContext {
    value: string
  }
}

let value = 'hello'
let ran = 0
const listeners = new Set<() => void>()

const source: CommandSource = {
  read: () => ({ value }),
  subscribe: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

function change(next: string) {
  value = next
  for (const listener of listeners) listener()
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <CommandSourceProvider source={source}>{children}</CommandSourceProvider>
)

beforeEach(() => {
  resetRegistry()
  value = 'hello'
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
    // Read on every call, which is what makes the flag follow the source.
    isEnabled: (context) => context.value.length > 4,
    run: () => {},
  })
})

describe('useCommand', () => {
  it('exposes the registry label and a platform-formatted shortcut', () => {
    const { result } = renderHook(() => useCommand('test.shout'), { wrapper })

    expect(result.current.label).toBe('Shout')
    expect(result.current.shortcut).toBe(isMac ? '⌘Z' : 'Ctrl+Z')
  })

  it('runs the registered command against the current context', () => {
    const { result } = renderHook(() => useCommand('test.shout'), { wrapper })

    act(() => {
      result.current.run()
    })
    expect(ran).toBe(1)
  })

  it('re-reads isEnabled when the source says the context changed', () => {
    const { result } = renderHook(() => useCommand('test.needs-text'), { wrapper })
    expect(result.current.isEnabled).toBe(true)

    act(() => {
      change('hi')
    })
    expect(result.current.isEnabled).toBe(false)
  })

  it('refuses to run a disabled command', () => {
    register({
      id: 'test.never',
      label: 'Never',
      group: 'edit',
      isEnabled: () => false,
      run: () => {
        ran += 1
      },
    })
    const { result } = renderHook(() => useCommand('test.never'), { wrapper })

    expect(result.current.isEnabled).toBe(false)
    act(() => {
      result.current.run()
    })
    expect(ran).toBe(0)
  })

  it('falls back to the id when a command is not registered', () => {
    const { result } = renderHook(() => useCommand('nope.missing'), { wrapper })

    expect(result.current.label).toBe('nope.missing')
    expect(result.current.command).toBeUndefined()
    expect(result.current.isEnabled).toBe(false)
  })

  it('is inert outside a provider rather than throwing', () => {
    // A surface can render before the app has anything to act on; greyed out is
    // the right answer there, a crash is not.
    const { result } = renderHook(() => useCommand('test.shout'))

    expect(result.current.label).toBe('Shout')
    expect(result.current.isEnabled).toBe(false)
    act(() => {
      result.current.run()
    })
    expect(ran).toBe(0)
  })
})
