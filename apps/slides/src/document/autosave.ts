import { invoke } from '@tauri-apps/api/core'
import { join } from '@tauri-apps/api/path'
import { autosaveDir, isTauri } from '@orangery/platform'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { decodeBase64, encodeBase64 } from './base64'
import type { RestoredPart } from '../store/deck-store'

/**
 * Crash recovery.
 *
 * A snapshot is a patch on the file the deck came from, not a deck: the parts
 * that differ from what is on disk. Writing the whole `.pptx` every few seconds would be simpler and is what a
 * smaller app could afford — but the target is a 300-slide deck with images
 * (CLAUDE.md), and re-zipping tens of megabytes on every pause in typing is a
 * stutter the person feels while the machinery meant to protect their work runs.
 *
 * The snapshot is an internal cache, never a user-facing format and never
 * offered in a Save dialog.
 */

export const AUTOSAVE_INTERVAL_MS = 5_000
export const SNAPSHOT_NAME = 'snapshot.json'

/** A part as it travels through JSON: XML as text, media as base64. */
export interface SnapshotPart {
  path: string
  text?: string
  data?: string
}

export interface Snapshot {
  /** Schema version, so an old snapshot from a previous build is not misread. */
  version: 1
  /**
   * The file the deck came from.
   *
   * Never null, unlike Docs: a deck exists only by being opened, so there is
   * always a file to replay onto. The day New Presentation lands, a snapshot
   * with no path has to carry the whole package instead.
   */
  path: string
  savedAt: string
  parts: SnapshotPart[]
}

export function buildSnapshot(
  path: string,
  pkg: OoxmlPackage,
  dirty: ReadonlySet<string>,
): Snapshot {
  const parts: SnapshotPart[] = []

  for (const partPath of dirty) {
    const part = pkg.parts.get(partPath)
    if (part === undefined) continue

    parts.push(
      part.text === undefined
        ? { path: partPath, data: encodeBase64(part.bytes) }
        : { path: partPath, text: part.text },
    )
  }

  return { version: 1, path, savedAt: new Date().toISOString(), parts }
}

/** The parts of a snapshot, in the shape the store puts back. */
export function partsOf(snapshot: Snapshot): RestoredPart[] {
  return snapshot.parts.map((part) =>
    part.text === undefined
      ? { path: part.path, bytes: decodeBase64(part.data ?? '') }
      : { path: part.path, text: part.text },
  )
}

function readPart(value: unknown): SnapshotPart | null {
  if (typeof value !== 'object' || value === null) return null
  const candidate = value as Record<string, unknown>

  const path = candidate['path']
  if (typeof path !== 'string' || path === '') return null

  const text = candidate['text']
  if (typeof text === 'string') return { path, text }

  const data = candidate['data']
  if (typeof data === 'string') return { path, data }

  // Neither: a part that says nothing about its contents would be restored as
  // an empty file, which is worse than not restoring it.
  return null
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
  // written by an older build, or truncated by the crash we are recovering from.
  if (typeof parsed !== 'object' || parsed === null) return null
  const candidate = parsed as Record<string, unknown>

  if (candidate['version'] !== 1) return null

  const path = candidate['path']
  if (typeof path !== 'string' || path === '') return null

  const savedAt = candidate['savedAt']
  if (typeof savedAt !== 'string') return null

  const rawParts = candidate['parts']
  if (!Array.isArray(rawParts)) return null

  const parts: SnapshotPart[] = []
  for (const raw of rawParts) {
    const part = readPart(raw)
    // One unreadable part makes the whole snapshot untrustworthy: recovering
    // the rest would hand back a deck missing a piece without saying so.
    if (part === null) return null
    parts.push(part)
  }

  return { version: 1, path, savedAt, parts }
}

export async function documentKey(sessionId: string): Promise<string> {
  if (!isTauri()) return 'test-key'
  return invoke<string>('document_key', { path: sessionId })
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

/** Called after a successful save: the file on disk is authoritative again. */
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
