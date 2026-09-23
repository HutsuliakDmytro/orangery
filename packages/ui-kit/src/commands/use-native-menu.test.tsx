import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { register, resetRegistry } from './registry'
import { CommandSourceProvider } from './source-provider'
import type { CommandSource } from './source'
import { useNativeMenu } from './use-native-menu'

/**
 * What reaches the native menu bar, and when.
 *
 * The bug this is written against: the menu bar showed the state the registry
 * was in when the window opened — everything greyed out, because nothing was
 * open yet — and never caught up, while the same commands ran perfectly from
 * their shortcuts. Whatever the cause on the day, these are the properties
 * that make it impossible: the state is sent whenever the registry's answer
 * changes, it is sent without rebuilding the bar, and a command that never
 * said it was disabled is enabled.
 *
 * The shell itself — that Rust puts the state on a real `NSMenuItem` — is not
 * reachable from here. `tauri-driver` has no macOS support (its own README
 * says so), so that half runs in the Linux job; see `tests/e2e/native-menu.spec.ts`.
 */

type Payload = { descriptors?: { id: string; enabled: boolean }[] } & {
  states?: { id: string; enabled: boolean; active: boolean | null }[]
}

const invoke = vi.fn((command: string, _payload?: Payload) =>
  Promise.resolve<unknown>(command === 'sync_command_menu' ? true : undefined),
)
const onFocusChanged = vi.fn(() => Promise.resolve(() => undefined))

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...(args as [string])),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => undefined),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ onFocusChanged: () => onFocusChanged() }),
}))
vi.mock('@orangery/platform', async (original) => {
  const actual = await original<Record<string, unknown>>()
  return { ...actual, isTauri: () => true }
})

/**
 * The context this suite's commands read.
 *
 * `value` is what `use-command.test.tsx` declares `CommandContext` to carry;
 * an app declares its own, and a second declaration here would be a second
 * shape for the same type. So the two states a menu item can be in are spelled
 * in it: `selected` and nothing.
 */
let context = { value: '' }
const listeners = new Set<() => void>()

const source: CommandSource = {
  read: () => context,
  subscribe: (listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

function change(value: string) {
  context = { value }
  for (const listener of listeners) listener()
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <CommandSourceProvider source={source}>{children}</CommandSourceProvider>
)

const calls = (command: string) => invoke.mock.calls.filter(([name]) => name === command)

beforeEach(() => {
  resetRegistry()
  invoke.mockClear()
  context = { value: '' }

  register({
    id: 'edit.copy',
    label: 'Copy',
    group: 'edit',
    shortcut: 'Mod+c',
    run: () => undefined,
    isEnabled: (ctx) => ctx.value === 'selected',
  })
  register({
    id: 'edit.paste',
    label: 'Paste',
    group: 'edit',
    shortcut: 'Mod+v',
    run: () => undefined,
    isEnabled: (ctx) => ctx.value !== '',
  })
  // The one that says nothing about itself, which is the default this got wrong.
  register({ id: 'view.zoom-in', label: 'Zoom In', group: 'view', run: () => undefined })
})

describe('the native menu', () => {
  it('builds itself once from the registry', async () => {
    renderHook(
      () => {
        useNativeMenu()
      },
      { wrapper },
    )

    await waitFor(() => {
      expect(calls('set_command_menu')).toHaveLength(1)
    })
  })

  it('says a command with nothing to say for itself is enabled', async () => {
    renderHook(
      () => {
        useNativeMenu()
      },
      { wrapper },
    )

    await waitFor(() => {
      expect(calls('set_command_menu')).toHaveLength(1)
    })

    const zoom = calls('set_command_menu')[0]?.[1]?.descriptors?.find(
      (one) => one.id === 'view.zoom-in',
    )

    expect(zoom?.enabled).toBe(true)
  })

  it('sends the new state when the registry’s answer changes', async () => {
    renderHook(
      () => {
        useNativeMenu()
      },
      { wrapper },
    )
    await waitFor(() => {
      expect(calls('set_command_menu')).toHaveLength(1)
    })

    act(() => {
      change('selected')
    })

    await waitFor(() => {
      expect(calls('sync_command_menu')).toHaveLength(1)
    })

    const states = calls('sync_command_menu')[0]?.[1]?.states ?? []
    const state = (id: string) => states.find((one) => one.id === id)?.enabled

    expect(state('edit.copy')).toBe(true)
    expect(state('edit.paste')).toBe(true)
  })

  it('does not rebuild the bar for a state change', async () => {
    renderHook(
      () => {
        useNativeMenu()
      },
      { wrapper },
    )
    await waitFor(() => {
      expect(calls('set_command_menu')).toHaveLength(1)
    })

    act(() => {
      change('selected')
    })
    await waitFor(() => {
      expect(calls('sync_command_menu')).toHaveLength(1)
    })

    expect(calls('set_command_menu')).toHaveLength(1)
  })

  it('says nothing at all when the answer has not changed', async () => {
    renderHook(
      () => {
        useNativeMenu()
      },
      { wrapper },
    )
    await waitFor(() => {
      expect(calls('set_command_menu')).toHaveLength(1)
    })

    act(() => {
      change('')
    })
    await new Promise((resolve) => setTimeout(resolve, 40))

    expect(calls('sync_command_menu')).toHaveLength(0)
  })

  it('rebuilds when Rust says the bar is not the one these states are about', async () => {
    invoke.mockImplementation((command: string) =>
      Promise.resolve(command === 'sync_command_menu' ? false : undefined),
    )

    renderHook(
      () => {
        useNativeMenu()
      },
      { wrapper },
    )
    await waitFor(() => {
      expect(calls('set_command_menu')).toHaveLength(1)
    })

    act(() => {
      change('selected')
    })

    await waitFor(() => {
      expect(calls('set_command_menu')).toHaveLength(2)
    })
  })

  it('follows a selection that comes and goes', async () => {
    renderHook(
      () => {
        useNativeMenu()
      },
      { wrapper },
    )
    await waitFor(() => {
      expect(calls('set_command_menu')).toHaveLength(1)
    })

    act(() => {
      change('selected')
    })
    await waitFor(() => {
      expect(calls('sync_command_menu')).toHaveLength(1)
    })

    act(() => {
      change('')
    })
    await waitFor(() => {
      expect(calls('sync_command_menu')).toHaveLength(2)
    })

    const states = calls('sync_command_menu')[1]?.[1]?.states ?? []

    expect(states.find((one) => one.id === 'edit.copy')?.enabled).toBe(false)
  })
})
