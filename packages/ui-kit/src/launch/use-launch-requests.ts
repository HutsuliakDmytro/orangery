import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useEffect, useLayoutEffect, useRef, useSyncExternalStore } from 'react'
import { isTauri } from '@orangery/platform'

/**
 * Files the operating system asked this window to open.
 *
 * A double-click in Finder, "Open With", a path in `argv` — all of them reach
 * `packages/tauri-shared/src/launch.rs` first and wait there until the window
 * asks. This is the asking.
 *
 * The order matters and is the whole fix for one of the two bugs this replaced.
 * The window **listens before it asks**: anything Rust sends after the answer
 * goes out as an event, and a window that asked first could miss one that
 * arrived in between. And the window **shows nothing until it has asked**: a
 * cold double-click used to draw the welcome screen and then, a moment later,
 * the file — or, half the time, only the welcome screen.
 */

/** What a window knows about the files it was asked to open. */
export interface LaunchState {
  /**
   * Rust has answered. Until then the window cannot know whether it is about
   * to show a file, so it shows neither the file nor the welcome screen.
   */
  settled: boolean
  /** The file being opened right now, for "Opening report.docx…". */
  opening: string | null
  /** The last file that would not open, and why. */
  failure: LaunchFailure | null
}

export interface LaunchFailure {
  path: string
  message: string
}

/**
 * Opens one file. Resolves to `null` when it opened, or to a sentence saying
 * why it did not — every app reports its own failures its own way, and this
 * needs them in one shape.
 */
export type OpenForLaunch = (path: string) => Promise<string | null>

const OPEN_EVENT = 'launch:open'

/**
 * The state, kept outside React so the welcome screen deep in a canvas can
 * read it without the shell threading it down.
 */
let state: LaunchState = { settled: !isTauri(), opening: null, failure: null }
const listeners = new Set<() => void>()

function update(next: Partial<LaunchState>): void {
  state = { ...state, ...next }
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * The asking, done once per page.
 *
 * Rust hands each path over exactly once, so a second ask gets nothing. React
 * in development mounts every effect twice, and the first mount is torn down
 * straight away — if it had asked and then been told to stop, the file would
 * be gone. So the answer is kept, and whichever mount survives acts on it.
 */
let claimed: Promise<string[]> | null = null

function claimOnce(): Promise<string[]> {
  claimed ??= invoke<unknown>('claim_open_requests').then(
    (paths) => (Array.isArray(paths) ? paths.filter((one) => typeof one === 'string') : []),
    (error: unknown) => {
      console.error('could not ask for the files this window was opened with', error)
      return []
    },
  )
  return claimed
}

/** For tests: back to a window that has not asked yet. */
export function resetLaunchState(settled = false): void {
  state = { settled, opening: null, failure: null }
  claimed = null
  for (const listener of listeners) listener()
}

/** What the window knows. Any component may read it. */
export function useLaunchState(): LaunchState {
  return useSyncExternalStore(subscribe, () => state)
}

/** Whether the launch screen has anything to show, for a caller choosing. */
export function useLaunchScreenShown(): boolean {
  const { settled, opening, failure } = useLaunchState()
  return !settled || opening !== null || failure !== null
}

/** Puts the failure away, so the welcome screen can come back. */
export function dismissLaunchFailure(): void {
  update({ failure: null })
}

/**
 * The file name, for a sentence. Both separators, because a Windows path
 * reaches here as it was given.
 */
export function fileNameOf(path: string): string {
  return path.split(/[\\/]/u).pop() ?? path
}

/**
 * Asks Rust for this window's files, opens them, and keeps listening.
 *
 * Called once, in the app's shell. `ready` is false while the app cannot yet
 * open anything — Docs before its editor exists — and the asking waits for it.
 * `vacant` is whether the window holds no document, reported back so a file
 * double-clicked later goes into a welcome screen rather than a new window,
 * and never into a window with a document in it.
 */
export function useLaunchRequests({
  ready,
  vacant,
  open,
}: {
  ready: boolean
  vacant: boolean
  open: OpenForLaunch
}): void {
  // Read through a ref so an app passing a new function every render does not
  // ask Rust again, which would be harmless and pointless.
  const opener = useRef(open)
  useLayoutEffect(() => {
    opener.current = open
  })

  useEffect(() => {
    if (!ready || !isTauri()) return

    // An object rather than a `let`: the flag is set by the cleanup, which
    // the compiler cannot see from inside the async function that reads it.
    const run = { cancelled: false }

    const attempt = async (path: string) => {
      update({ opening: path })
      let failure: string | null
      try {
        failure = await opener.current(path)
      } catch (error) {
        failure = error instanceof Error ? error.message : String(error)
      }
      update({
        opening: null,
        failure: failure === null ? null : { path, message: failure },
      })
    }

    const stop = listen<string>(OPEN_EVENT, (event) => {
      void attempt(event.payload)
    })

    void (async () => {
      await stop
      const paths = await claimOnce()
      if (run.cancelled) return

      for (const path of paths) await attempt(path)
      update({ settled: true })
    })()

    return () => {
      run.cancelled = true
      void stop.then((unlisten) => {
        unlisten()
      })
    }
  }, [ready])

  const { settled } = useLaunchState()

  useEffect(() => {
    // Not before it has asked: a welcome screen that reports itself empty
    // before Rust has handed over the file it was opened for would invite the
    // next double-click into a window that is about to be full.
    // A document opened some other way since — the Open dialog, a recent
    // file — and the failure belongs to a moment that has passed. Left alone
    // it would come back the next time the window was empty.
    if (!vacant && state.failure !== null) update({ failure: null })

    if (!settled || !isTauri()) return
    void invoke('report_vacancy', { vacant }).catch((error: unknown) => {
      console.error('could not report whether this window is empty', error)
    })
  }, [vacant, settled])
}
