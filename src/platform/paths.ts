/**
 * Application paths. Resolved through Tauri so each OS gets its own convention:
 *   macOS   ~/Library/Application Support/com.orangery.docs
 *   Windows %APPDATA%\com.orangery.docs
 *   Linux   ~/.local/share/com.orangery.docs
 *
 * Nothing outside `src/platform/` should build these paths by hand.
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
