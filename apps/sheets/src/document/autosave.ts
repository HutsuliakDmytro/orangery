import { invoke } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { autosaveDir, isTauri } from '@orangery/platform'
import { decodeBytes, encodeBytes } from '@orangery/ooxml-core'

/**
 * Crash recovery.
 *
 * The snapshot is an internal cache, never a user-facing format and never
 * offered in a Save dialog (`apps/sheets/CLAUDE.md`). It holds the whole
 * workbook, because unlike a document there is nothing on disk to fall back
 * to: a workbook that was never saved has no file, and one that was has a file
 * without the edits. Excel writes the whole thing too, and for the same
 * reason.
 *
 * Which makes the interval a real decision. Every few seconds would mean
 * rebuilding a forty-megabyte zip while somebody is typing; half a minute is
 * long enough to be cheap and short enough that what a crash costs is a
 * sentence rather than an afternoon.
 */

export const AUTOSAVE_INTERVAL_MS = 30_000
export const SNAPSHOT_NAME = 'snapshot.json'

export interface Snapshot {
  /** Schema version, so a snapshot from an older build is not misread. */
  version: 1
  /** The file it came from, or null for a workbook that was never saved. */
  path: string | null
  savedAt: string
  /** The package, as text, because that is all a snapshot can hold. */
  workbook: string
}

export const buildSnapshot = (path: string | null, bytes: Uint8Array): Snapshot => ({
  version: 1,
  path,
  savedAt: new Date().toISOString(),
  workbook: encodeBytes(bytes),
})

/** Rejects anything that is not a snapshot this build understands. */
export function parseSnapshot(contents: string): { snapshot: Snapshot; bytes: Uint8Array } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return null
  }

  // Unknown throughout: this came off disk, and may have been written by an
  // older build or half-written by the crash being recovered from.
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>

  if (candidate['version'] !== 1) return null
  if (typeof candidate['workbook'] !== 'string') return null
  if (typeof candidate['savedAt'] !== 'string') return null

  const bytes = decodeBytes(candidate['workbook'])
  if (bytes === null || bytes.length === 0) return null

  const path = candidate['path']

  return {
    snapshot: {
      version: 1,
      path: typeof path === 'string' ? path : null,
      savedAt: candidate['savedAt'],
      workbook: candidate['workbook'],
    },
    bytes,
  }
}

/**
 * The directory a workbook's snapshot lives in.
 *
 * Keyed by the editing session rather than the file path. A workbook that was
 * never saved has no path to key by; and one saved under a new name would have
 * its snapshot written under the old key and cleared under the new one, so the
 * old snapshot would survive and be offered as recoverable at every launch.
 */
export async function snapshotKey(session: string): Promise<string> {
  if (!isTauri()) return 'test-key'
  return invoke<string>('document_key', { path: session })
}

const directoryFor = async (key: string): Promise<string> => join(await autosaveDir(), key)

export async function writeSnapshot(key: string, snapshot: Snapshot): Promise<void> {
  if (!isTauri()) return

  await invoke('write_autosave', {
    directory: await directoryFor(key),
    name: SNAPSHOT_NAME,
    contents: JSON.stringify(snapshot),
  })
}

export async function readSnapshot(key: string): Promise<Uint8Array | null> {
  if (!isTauri()) return null

  const contents = await invoke<string | null>('read_autosave', {
    directory: await directoryFor(key),
    name: SNAPSHOT_NAME,
  })

  return contents === null ? null : (parseSnapshot(contents)?.bytes ?? null)
}

/** Forgets a snapshot, which is what closing a workbook cleanly means. */
export async function clearSnapshot(key: string): Promise<void> {
  if (!isTauri()) return
  await invoke('clear_autosave', { directory: await directoryFor(key) })
}

export interface Recoverable {
  key: string
  path: string | null
  savedAt: string
}

/**
 * The workbooks that were not closed cleanly.
 *
 * A directory that is still there is one nobody cleared, which happens when
 * the program stopped without being asked to. A snapshot that will not parse
 * is not offered — recovering half a file is worse than admitting the loss —
 * but it is left on disk rather than deleted, because a file nobody can read
 * is still a file somebody might want looked at.
 */
export async function recoverable(): Promise<Recoverable[]> {
  if (!isTauri()) return []

  const keys = await invoke<string[]>('list_autosaves', { root: await autosaveDir() })
  const found: Recoverable[] = []

  for (const key of keys) {
    const contents = await invoke<string | null>('read_autosave', {
      directory: await directoryFor(key),
      name: SNAPSHOT_NAME,
    })

    const parsed = contents === null ? null : parseSnapshot(contents)
    if (parsed !== null) {
      found.push({ key, path: parsed.snapshot.path, savedAt: parsed.snapshot.savedAt })
    }
  }

  return found
}
