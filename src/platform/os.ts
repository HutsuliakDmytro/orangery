/**
 * OS detection. This module and its siblings in `src/platform/` are the only
 * place in the app allowed to branch on the operating system — see CLAUDE.md.
 */

export type OperatingSystem = 'macos' | 'windows' | 'linux' | 'unknown'

function detect(): OperatingSystem {
  if (typeof navigator === 'undefined') return 'unknown'

  // `userAgentData` is not in every webview yet, so the UA string stays as fallback.
  const platform = (
    (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ??
    navigator.userAgent
  ).toLowerCase()

  if (platform.includes('mac')) return 'macos'
  if (platform.includes('win')) return 'windows'
  if (platform.includes('linux') || platform.includes('x11')) return 'linux'
  return 'unknown'
}

export const currentOs: OperatingSystem = detect()

export const isMac = currentOs === 'macos'
export const isWindows = currentOs === 'windows'
export const isLinux = currentOs === 'linux'

/**
 * True when running inside the Tauri shell rather than a plain browser or jsdom.
 * Guards every call into the native layer so tests and `pnpm dev` in a browser
 * degrade instead of throwing.
 */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}
