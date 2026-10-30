import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

/** What `previous_run` answers: the run before this one, if it ended without saying so. */
export interface PreviousRun {
  marker: string
  launchLog: string
  crashLog: string | null
}

/**
 * Asked once per page, and only by the main window: every window would
 * otherwise say the same thing about the same run.
 */
let asked: Promise<PreviousRun | null> | null = null

export function askOnce(): Promise<PreviousRun | null> {
  asked ??= invoke<PreviousRun | null>('previous_run').catch(() => null)
  return asked
}

/** This window's label, or `main` where there is no window to ask. */
export function windowLabel(): string {
  try {
    return getCurrentWindow().label
  } catch {
    return 'main'
  }
}

/** For tests. */
export function resetPreviousRun(): void {
  asked = null
}
