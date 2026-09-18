import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
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

/** Picks a picture to put on a slide. */
export async function pickPicturePath(): Promise<string | null> {
  if (!isTauri()) return null

  const selected = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: 'Picture', extensions: ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp'] }],
  })

  return typeof selected === 'string' ? selected : null
}

/** Reads any file the app was pointed at, through the same Rust command. */
export async function readFileBytes(path: string): Promise<Uint8Array> {
  const loaded = await invoke<LoadedFile>('read_document', { path })
  return new Uint8Array(loaded.bytes)
}

/** What a save did, for the message that follows it. */
export interface SaveResult {
  path: string
  /** The copy of what was there before, when one was kept. */
  backupPath: string | null
}

export async function pickSavePath(suggestedName: string): Promise<string | null> {
  if (!isTauri()) return null

  const selected = await saveDialog({
    defaultPath: suggestedName,
    filters: [{ name: 'Presentation', extensions: ['pptx'] }],
  })

  return selected ?? null
}

/**
 * Writes a deck to disk.
 *
 * Through Rust, which writes to a temporary file beside the target and renames
 * it into place: a webview cannot do that, and a half-written deck is a deck
 * nobody gets back. The copy of what was there before is kept for the same
 * reason.
 */
export async function writeDeckFile(
  path: string,
  bytes: Uint8Array,
  keepBackup = true,
): Promise<SaveResult> {
  const result = await invoke<{ path: string; backup_path: string | null }>('write_document', {
    path,
    bytes: [...bytes],
    keepBackup,
  })

  return { path: result.path, backupPath: result.backup_path }
}

/** A directory to put a deck's worth of pictures in. */
export async function pickDirectory(): Promise<string | null> {
  if (!isTauri()) return null

  const selected = await openDialog({ directory: true, multiple: false })
  return typeof selected === 'string' ? selected : null
}

/** Somewhere to put one exported file, with the extension already suggested. */
export async function pickExportPath(suggestedName: string, extension: string) {
  if (!isTauri()) return null

  const selected = await saveDialog({
    defaultPath: suggestedName,
    filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
  })

  return selected ?? null
}

/**
 * Writes bytes that are not a deck.
 *
 * No backup: a picture being exported has no previous version worth keeping,
 * and a `.png.bak` beside every slide would be a directory nobody wants.
 */
export async function writeFileBytes(path: string, bytes: Uint8Array): Promise<void> {
  await invoke('write_document', { path, bytes: [...bytes], keepBackup: false })
}
