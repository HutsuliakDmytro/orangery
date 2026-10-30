import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PreviousRunBanner } from './previous-run-banner'
import { resetPreviousRun } from './previous-run'

/**
 * Saying that the last run died, once, with its log a click away.
 *
 * Whether it died is Rust's to know — `trail.rs` and its tests. What is
 * tested here is that the page says so when told, says nothing when not, and
 * offers the right file.
 */

let answer: unknown = null
let label = 'main'
const invoke = vi.fn((command: string, _payload?: unknown) =>
  Promise.resolve(command === 'previous_run' ? answer : undefined),
)

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...(args as [string, unknown])),
}))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ label }),
}))
vi.mock('@orangery/platform', async (original) => {
  const actual = await original<Record<string, unknown>>()
  return { ...actual, isTauri: () => true }
})

const LOG = '/Users/somebody/Library/Application Support/com.orangery.docs/logs/launch.log'

beforeEach(() => {
  answer = null
  label = 'main'
  invoke.mockClear()
  resetPreviousRun()
})

describe('the run before this one', () => {
  it('says nothing when it ended cleanly', async () => {
    render(<PreviousRunBanner appName="Orangery Docs" />)
    await vi.waitFor(() => {
      expect(invoke).toHaveBeenCalledWith('previous_run')
    })
    expect(screen.queryByRole('status')).toBeNull()
  })

  it('says so when it did not, and names the log', async () => {
    answer = { marker: 'pid=1 started=2', launchLog: LOG, crashLog: null }
    render(<PreviousRunBanner appName="Orangery Docs" />)

    const banner = await screen.findByRole('status')
    expect(banner.textContent).toContain('Orangery Docs did not close properly last time')
    expect(banner.textContent).toContain('launch.log')
  })

  it('shows the panic rather than the trail, when there was one', async () => {
    const crash = LOG.replace('launch.log', 'crash-123.log')
    answer = { marker: 'pid=1 started=2', launchLog: LOG, crashLog: crash }
    render(<PreviousRunBanner appName="Orangery Docs" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Show Log' }))

    expect(invoke).toHaveBeenCalledWith('reveal_log', { path: crash })
  })

  it('goes when dismissed', async () => {
    answer = { marker: 'pid=1 started=2', launchLog: LOG, crashLog: null }
    render(<PreviousRunBanner appName="Orangery Docs" />)

    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss' }))

    expect(screen.queryByRole('status')).toBeNull()
  })

  it('is said by the first window only', async () => {
    // A second window is the same run, with nothing new to say about the last.
    label = 'win-1'
    answer = { marker: 'pid=1 started=2', launchLog: LOG, crashLog: null }
    render(<PreviousRunBanner appName="Orangery Docs" />)

    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(invoke).not.toHaveBeenCalledWith('previous_run')
    expect(screen.queryByRole('status')).toBeNull()
  })
})
