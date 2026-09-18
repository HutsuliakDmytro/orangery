import { invoke } from '@tauri-apps/api/core'
import { appDataRoot } from './paths'
import { isTauri } from './os'

/**
 * The File → Open Recent list.
 *
 * Stored in app data rather than in the document, and capped: a recent list that
 * grows without bound turns into a second, worse file browser.
 *
 * Here rather than in an app because every app in the suite keeps the same list
 * of the same shape, and because this package is what owns the app data
 * directory — the list is one of the things in it. Nothing about it is specific
 * to documents or to decks: it is paths and the order they were last opened in.
 */

/** The name a path ends with, which is what a person recognises it by. */
function nameOf(path: string): string {
  const name = path.split(/[\\/]/u).pop()
  return name === undefined || name === '' ? path : name
}

export const MAX_RECENT_FILES = 10
export const RECENT_FILES_NAME = 'recent-files.json'

export interface RecentFile {
  path: string
  name: string
  openedAt: string
}

export function addRecent(existing: readonly RecentFile[], path: string): RecentFile[] {
  const entry: RecentFile = {
    path,
    name: nameOf(path),
    openedAt: new Date().toISOString(),
  }

  // Re-opening a file moves it to the top rather than adding a duplicate.
  const withoutDuplicate = existing.filter((file) => file.path !== path)
  return [entry, ...withoutDuplicate].slice(0, MAX_RECENT_FILES)
}

export function removeRecent(existing: readonly RecentFile[], path: string): RecentFile[] {
  return existing.filter((file) => file.path !== path)
}

/** Rejects anything that is not a recent-file list this build understands. */
export function parseRecentFiles(contents: string): RecentFile[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(contents)
  } catch {
    return []
  }

  if (!Array.isArray(parsed)) return []

  const files: RecentFile[] = []
  for (const candidate of parsed) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const entry = candidate as Record<string, unknown>

    const path = entry['path']
    if (typeof path !== 'string' || path === '') continue

    files.push({
      path,
      name: typeof entry['name'] === 'string' ? entry['name'] : nameOf(path),
      openedAt: typeof entry['openedAt'] === 'string' ? entry['openedAt'] : '',
    })
  }

  return files.slice(0, MAX_RECENT_FILES)
}

export async function loadRecentFiles(): Promise<RecentFile[]> {
  if (!isTauri()) return []

  const contents = await invoke<string | null>('read_autosave', {
    directory: await appDataRoot(),
    name: RECENT_FILES_NAME,
  })

  return contents === null ? [] : parseRecentFiles(contents)
}

export async function saveRecentFiles(files: readonly RecentFile[]): Promise<void> {
  if (!isTauri()) return

  await invoke('write_autosave', {
    directory: await appDataRoot(),
    name: RECENT_FILES_NAME,
    contents: JSON.stringify(files),
  })
}

export async function rememberRecent(path: string): Promise<RecentFile[]> {
  const updated = addRecent(await loadRecentFiles(), path)
  await saveRecentFiles(updated)
  return updated
}
