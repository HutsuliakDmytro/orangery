/**
 * Keyboard shortcut helpers.
 *
 * Shortcuts are always written with `Mod` — it resolves to Cmd on macOS and Ctrl
 * elsewhere. Never hardcode `Cmd` or `Ctrl` outside this module (CLAUDE.md).
 */

import { isMac } from './os'

/** Modifier tokens accepted in a shortcut string. */
export type Modifier = 'Mod' | 'Alt' | 'Shift' | 'Ctrl' | 'Cmd'

/** A shortcut in ProseMirror/Tiptap notation, e.g. `Mod+Shift+P`. */
export type Shortcut = string

/** The concrete key that `Mod` stands for on this platform. */
export const modKey = isMac ? 'Meta' : 'Control'

/** Resolves `Mod` to the platform modifier, for passing to a keymap. */
export function resolveShortcut(shortcut: Shortcut): string {
  return shortcut.replace(/\bMod\b/g, isMac ? 'Cmd' : 'Ctrl')
}

const MAC_SYMBOLS: Readonly<Record<string, string>> = {
  Mod: '⌘',
  Cmd: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  Enter: '↩',
  Backspace: '⌫',
  Delete: '⌦',
  Tab: '⇥',
  Escape: '⎋',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
}

const OTHER_LABELS: Readonly<Record<string, string>> = {
  Mod: 'Ctrl',
  Cmd: 'Win',
  Escape: 'Esc',
}

/**
 * Human-readable shortcut for menus and tooltips:
 * `Mod+Shift+P` → `⌘⇧P` on macOS, `Ctrl+Shift+P` elsewhere.
 */
export function formatShortcut(shortcut: Shortcut): string {
  const parts = shortcut.split('+')
  if (isMac) {
    return parts.map((part) => MAC_SYMBOLS[part] ?? part.toUpperCase()).join('')
  }
  return parts.map((part) => OTHER_LABELS[part] ?? part).join('+')
}

/** True when the event carries the platform's primary modifier. */
export function hasMod(event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>): boolean {
  return isMac ? event.metaKey : event.ctrlKey
}
