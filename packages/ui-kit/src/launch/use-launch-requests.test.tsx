import { act, render, renderHook, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LaunchScreen } from './launch-screen'
import {
  resetLaunchState,
  useLaunchRequests,
  useLaunchScreenShown,
  useLaunchState,
} from './use-launch-requests'

/**
 * The window's half of opening a file the operating system asked for.
 *
 * Rust's half — which window a file goes to, and the queue that holds it
 * until the window asks — is tested in `packages/tauri-shared/src/launch.rs`.
 * What is tested here is the order of the asking, because the order is the
 * bug: a window that asked before it listened could miss a file, and a window
 * that drew before it asked showed the welcome screen first.
 */

const calls: string[] = []
let claimed: string[] = []
let deliver: ((path: string) => void) | null = null

const invoke = vi.fn((command: string, _payload?: unknown) => {
  calls.push(command)
  return Promise.resolve<unknown>(command === 'claim_open_requests' ? claimed : undefined)
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...(args as [string, unknown])),
}))
vi.mock('@tauri-apps/api/event', () => ({
  listen: (name: string, handler: (event: { payload: string }) => void) => {
    calls.push(`listen ${name}`)
    deliver = (path) => {
      handler({ payload: path })
    }
    return Promise.resolve(() => {
      deliver = null
    })
  },
}))
vi.mock('@orangery/platform', async (original) => {
  const actual = await original<Record<string, unknown>>()
  return { ...actual, isTauri: () => true }
})

beforeEach(() => {
  calls.length = 0
  claimed = []
  deliver = null
  invoke.mockClear()
  resetLaunchState()
})

function useHarness(open: (path: string) => Promise<string | null>, vacant = true) {
  useLaunchRequests({ ready: true, vacant, open })
  return { state: useLaunchState(), shown: useLaunchScreenShown() }
}

describe('a window opened on a file', () => {
  it('listens before it asks, so nothing falls between the two', async () => {
    renderHook(() => useHarness(() => Promise.resolve(null)))

    await waitFor(() => {
      expect(calls).toContain('claim_open_requests')
    })
    expect(calls.indexOf('listen launch:open')).toBeLessThan(calls.indexOf('claim_open_requests'))
  })

  it('shows nothing until it knows, rather than the welcome screen', () => {
    // Rust has not answered yet. The welcome screen flashing up before the
    // file was half of the bug.
    const { result } = renderHook(() => useHarness(() => Promise.resolve(null)))

    expect(result.current.state.settled).toBe(false)
    expect(result.current.shown).toBe(true)
  })

  it('opens what was waiting for it', async () => {
    claimed = ['/Users/somebody/report.docx']
    const open = vi.fn(() => Promise.resolve(null))

    const { result } = renderHook(() => useHarness(open))

    await waitFor(() => {
      expect(result.current.state.settled).toBe(true)
    })
    expect(open).toHaveBeenCalledWith('/Users/somebody/report.docx')
    expect(result.current.shown).toBe(false)
  })

  it('settles on an empty answer, so the welcome screen can show', async () => {
    const { result } = renderHook(() => useHarness(() => Promise.resolve(null)))

    await waitFor(() => {
      expect(result.current.state.settled).toBe(true)
    })
    expect(result.current.shown).toBe(false)
  })

  it('does not lose the file to a development double mount', async () => {
    // React mounts every effect twice in StrictMode and tears the first down
    // at once. Rust hands a path over only once; if the torn-down mount had
    // asked and thrown the answer away, the file would be gone.
    claimed = ['/Users/somebody/report.docx']
    const open = vi.fn(() => Promise.resolve(null))
    const wrapper = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>

    const { result } = renderHook(() => useHarness(open), { wrapper })

    await waitFor(() => {
      expect(result.current.state.settled).toBe(true)
    })
    expect(invoke.mock.calls.filter(([name]) => name === 'claim_open_requests')).toHaveLength(1)
    expect(open).toHaveBeenCalledTimes(1)
  })
})

describe('a file that will not open', () => {
  it('is said in the window, not left as an empty welcome screen', async () => {
    claimed = ['/Users/somebody/locked.docx']

    function Harness() {
      useLaunchRequests({
        ready: true,
        vacant: true,
        open: () => Promise.resolve('You do not have permission to read this file.'),
      })
      return <LaunchScreen appName="Orangery Docs" onOpenAnother={() => undefined} />
    }

    render(<Harness />)

    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toContain('Orangery Docs could not open “locked.docx”')
    expect(alert.textContent).toContain('You do not have permission to read this file.')
  })

  it('is said even when opening throws rather than answering', async () => {
    claimed = ['/Users/somebody/gone.docx']
    const { result } = renderHook(() =>
      useHarness(() => Promise.reject(new Error('The file is not there any more.'))),
    )

    await waitFor(() => {
      expect(result.current.state.failure?.message).toBe('The file is not there any more.')
    })
  })

  it('is forgotten once a document is open', async () => {
    claimed = ['/Users/somebody/locked.docx']
    const { result, rerender } = renderHook(
      ({ vacant }: { vacant: boolean }) => useHarness(() => Promise.resolve('No.'), vacant),
      { initialProps: { vacant: true } },
    )
    await waitFor(() => {
      expect(result.current.state.failure).not.toBeNull()
    })

    rerender({ vacant: false })

    expect(result.current.state.failure).toBeNull()
  })
})

describe('a window already running', () => {
  it('opens a file Rust sends it later', async () => {
    const open = vi.fn(() => Promise.resolve(null))
    const { result } = renderHook(() => useHarness(open))
    await waitFor(() => {
      expect(result.current.state.settled).toBe(true)
    })

    act(() => {
      deliver?.('/Users/somebody/second.docx')
    })

    await waitFor(() => {
      expect(open).toHaveBeenCalledWith('/Users/somebody/second.docx')
    })
  })

  it('says whether it is empty, but only once it has asked', async () => {
    // Reported too early, an empty welcome screen would invite the next
    // double-click into a window about to be filled by the first.
    claimed = ['/Users/somebody/report.docx']
    renderHook(() => useHarness(() => Promise.resolve(null)))

    await waitFor(() => {
      expect(calls).toContain('report_vacancy')
    })
    expect(calls.indexOf('claim_open_requests')).toBeLessThan(calls.indexOf('report_vacancy'))
  })
})
