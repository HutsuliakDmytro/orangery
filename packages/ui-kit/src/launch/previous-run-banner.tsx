import { invoke } from '@tauri-apps/api/core'
import { AlertTriangle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { isTauri } from '@orangery/platform'

/**
 * The run before this one, if it ended without saying so.
 *
 * `packages/tauri-shared/src/trail.rs` leaves a marker at start and removes it
 * on a clean exit. A marker still there at the next start means the last run
 * died — a panic, a signal, a force-quit — and what it was doing in its first
 * seconds is in `launch.log`. This says so, once, with the log a click away,
 * because a log nobody knows exists is a log nobody sends.
 */

import { askOnce, windowLabel } from './previous-run'
import type { PreviousRun } from './previous-run'

export function PreviousRunBanner({ appName }: { appName: string }) {
  const [previous, setPrevious] = useState<PreviousRun | null>(null)

  useEffect(() => {
    if (!isTauri()) return
    // A second window is the same run; it has nothing new to say.
    if (windowLabel() !== 'main') return

    let live = true
    void askOnce().then((found) => {
      if (live) setPrevious(found)
    })
    return () => {
      live = false
    }
  }, [])

  if (previous === null) return null

  const log = previous.crashLog ?? previous.launchLog
  const name = log.split(/[\\/]/u).pop() ?? log

  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-border bg-surface px-4 py-2 text-sm text-text"
    >
      <AlertTriangle size={16} aria-hidden className="shrink-0 text-danger" />
      <span className="min-w-0 flex-1">
        {appName} did not close properly last time. What it was doing is in{' '}
        <span className="font-mono text-xs">{name}</span>.
      </span>
      <button
        type="button"
        onClick={() => {
          void invoke('reveal_log', { path: log }).catch((error: unknown) => {
            console.error('could not show the log', error)
          })
        }}
        className="shrink-0 rounded border border-border px-2 py-0.5 text-xs text-text hover:border-accent"
      >
        Show Log
      </button>
      <button
        type="button"
        onClick={() => {
          setPrevious(null)
        }}
        className="shrink-0 rounded px-2 py-0.5 text-xs text-muted hover:text-text"
      >
        Dismiss
      </button>
    </div>
  )
}
