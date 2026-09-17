import { invoke } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { autosaveDir } from '@orangery/platform'
import { isTauri } from '@orangery/platform'
import type { ProseMirrorNodeJson } from '../ooxml/parse-document'

/**
 * Crash recovery.
 *
 * The snapshot is an internal cache, never a user-facing format and never offered
 * in a Save dialog (CLAUDE.md). It holds the ProseMirror document plus the path
 * it came from, which is enough to rebuild the editing state: the preserved
 * package parts still live in the original file on disk.
 */

export const AUTOSAVE_INTERVAL_MS = 5_000
export const SNAPSHOT_NAME = 'snapshot.json'

export interface Snapshot {
  /** Schema version, so an old snapshot from a previous build is not misread. */
  version: 1
  /** Source file, or null for a document that was never saved. */
  path: string | null
  savedAt: string
  doc: ProseMirrorNodeJson
}

export function buildSnapshot(path: string | null, doc: ProseMirrorNodeJson): Snapshot {
  return { version: 1, path, savedAt: new Date().toISOString(), doc }
}

/** Rejects anything that is not a snapshot this build understands. */
export function parseSnapshot(contents: string): Snapshot | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return null
  }

  // Treated as unknown throughout: this file came off disk and may have been
  // written by an older build, or corrupted by the crash we are recovering from.
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate: Record<string, unknown> = parsed as Record<string, unknown>

  if (candidate['version'] !== 1) return null

  const doc = candidate['doc']
  if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null

  const savedAt = candidate['savedAt']
  if (typeof savedAt !== 'string') return null

  const path = candidate['path']

  return {
    version: 1,
    path: typeof path === 'string' ? path : null,
    savedAt,
    doc: doc as ProseMirrorNodeJson,
  }
}

export async function documentKey(pathOrSession: string): Promise<string> {
  if (!isTauri()) return 'test-key'
  return invoke<string>('document_key', { path: pathOrSession })
}

/**
 * The directory a document's snapshot lives in.
 *
 * Keyed by the editing session and never by the file path. A document that was
 * never saved has no path to key by, and one saved under a new name would have
 * its snapshot written under the old key and cleared under the new one — so the
 * old snapshot would survive and be offered as recoverable at every launch.
 */
export function snapshotKey(sessionId: string): Promise<string> {
  return documentKey(sessionId)
}

async function directoryFor(key: string): Promise<string> {
  return join(await autosaveDir(), key)
}

export async function writeSnapshot(key: string, snapshot: Snapshot): Promise<void> {
  if (!isTauri()) return
  await invoke('write_autosave', {
    directory: await directoryFor(key),
    name: SNAPSHOT_NAME,
    contents: JSON.stringify(snapshot),
  })
}

export async function readSnapshot(key: string): Promise<Snapshot | null> {
  if (!isTauri()) return null

  const contents = await invoke<string | null>('read_autosave', {
    directory: await directoryFor(key),
    name: SNAPSHOT_NAME,
  })

  return contents === null ? null : parseSnapshot(contents)
}

/** Called after a successful save: the file on disk is now authoritative. */
export async function clearSnapshot(key: string): Promise<void> {
  if (!isTauri()) return
  await invoke('clear_autosave', { directory: await directoryFor(key) })
}

/**
 * A snapshot together with the directory it was found in.
 *
 * The key travels with it because it cannot be derived again: it is the id of
 * an editing session that has since ended, and nothing in the snapshot records
 * it. Without it, discarding has no directory to delete.
 */
export interface RecoverableSnapshot {
  key: string
  snapshot: Snapshot
}

/** Snapshots left behind by a session that did not exit cleanly. */
export async function listRecoverable(): Promise<RecoverableSnapshot[]> {
  if (!isTauri()) return []

  const keys = await invoke<string[]>('list_autosaves', { root: await autosaveDir() })
  const found: RecoverableSnapshot[] = []

  for (const key of keys) {
    const snapshot = await readSnapshot(key)
    if (snapshot) found.push({ key, snapshot })
  }

  return found
}
