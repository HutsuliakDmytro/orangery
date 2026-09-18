import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

/**
 * The shell's idea of where things live.
 *
 * Stood in for once here rather than in every test that pretends to be in
 * Tauri: the window looks for crash snapshots as it mounts, so any test that
 * renders it needs an app data directory whether or not it cares about one.
 */
vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: () => Promise.resolve('/app-data'),
  appLogDir: () => Promise.resolve('/app-data/logs'),
  join: (...parts: string[]) => Promise.resolve(parts.join('/')),
}))
