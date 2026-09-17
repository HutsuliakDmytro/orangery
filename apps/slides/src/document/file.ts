import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { isTauri } from '@orangery/platform'

/**
 * Getting a deck off the disk.
 *
 * Reading goes through Rust rather than the webview: it is the same command
 * Docs uses, from `@orangery/tauri-shared`, and writing will need to be atomic
 * with a backup, which a webview cannot do.
 */

interface LoadedFile {
  bytes: number[]
  path: string
  modifiedMs: number | null
}

export async function pickDeckPath(): Promise<string | null> {
  if (!isTauri()) return null

  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: 'Presentation', extensions: ['pptx'] }],
  })

  return typeof selected === 'string' ? selected : null
}

export async function readDeckFile(path: string): Promise<Uint8Array> {
  const loaded = await invoke<LoadedFile>('read_document', { path })
  return new Uint8Array(loaded.bytes)
}

/** The file name, for the window title, without walking a path library. */
export function nameOf(path: string): string {
  return path.split(/[\\/]/u).pop() ?? path
}
