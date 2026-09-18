import { invoke } from '@tauri-apps/api/core'
import { isTauri } from '@orangery/platform'

/**
 * Putting the show on a screen of its own.
 *
 * The deck reaches the other windows as a file. It already goes to disk on
 * every save, so this is a path the app is sure of; sending a package through
 * IPC as a JSON array of numbers is megabytes of text for something that is
 * already bytes.
 *
 * Every one of these is a no-op outside Tauri, where there is one window and
 * the show runs in it. Nothing else about the show depends on the answer, which
 * is why a failure here never stops a presentation.
 */

export interface ShowSource {
  path: string
  at: number
}

/** Where the copy the show reads is kept, beside the autosaves. */
async function temporaryDeckPath(): Promise<string> {
  const { tempDir, join } = await import('@tauri-apps/api/path')
  return join(await tempDir(), 'orangery-show.pptx')
}

/**
 * Opens the show window, and the presenter view if there is a second screen.
 *
 * Returns whether a presenter view was opened — with one screen it would be the
 * thing the room is looking at, so it is not, and the caller says so rather
 * than leaving a person wondering where it went.
 */
export async function openShowWindows(deck: Uint8Array, at: number): Promise<boolean> {
  if (!isTauri()) return false

  const path = await temporaryDeckPath()
  await invoke('write_document', { path, bytes: [...deck], keepBackup: false })

  return await invoke<boolean>('start_show', { path, at, monitor: null })
}

/** What this window was opened to show, or null when it was not opened for one. */
export async function showSource(): Promise<ShowSource | null> {
  if (!isTauri()) return null
  return (await invoke<ShowSource | null>('show_source')) ?? null
}

export async function closeShowWindows(): Promise<void> {
  if (!isTauri()) return
  await invoke('end_show')
}
