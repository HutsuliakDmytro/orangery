/**
 * Application paths. Resolved through Tauri so each OS gets its own convention,
 * under the bundle id of whichever app is asking:
 *   macOS   ~/Library/Application Support/com.orangery.docs
 *   Windows %APPDATA%\com.orangery.docs
 *   Linux   ~/.local/share/com.orangery.docs
 *
 * Two apps therefore never share a directory without meaning to, and neither
 * has to know the other exists.
 *
 * Nothing outside this package should build these paths by hand.
 */

import { appDataDir, appLogDir, join } from '@tauri-apps/api/path'

/** Root of the app's own data directory. */
export function appDataRoot(): Promise<string> {
  return appDataDir()
}

/** Where crash-recovery snapshots live. Internal cache, never user-facing (CLAUDE.md). */
export async function autosaveDir(): Promise<string> {
  return join(await appDataDir(), 'autosave')
}

/** Snapshot directory for a single document, keyed by a hash of its path. */
export async function autosaveDirFor(documentHash: string): Promise<string> {
  return join(await autosaveDir(), documentHash)
}

/** Persisted UI settings, recent files, window state. */
export async function settingsFile(): Promise<string> {
  return join(await appDataDir(), 'settings.json')
}

/** Local-only crash/diagnostic log. No telemetry leaves the machine (CLAUDE.md). */
export function logDir(): Promise<string> {
  return appLogDir()
}

/**
 * The last segment of a path, whichever separator the system uses.
 *
 * Here because which character separates a path is a fact about the operating
 * system, and this package is the only place allowed to know one. It was
 * written out six times across the workspace before it was written down once.
 *
 * Both separators are accepted rather than the current platform's: a path can
 * arrive from a file somebody else saved, and a Windows path shown on a Mac
 * should still be read as a path.
 */
export function baseName(path: string): string {
  const name = path.split(/[\\/]/u).pop()
  return name === undefined || name === '' ? path : name
}
