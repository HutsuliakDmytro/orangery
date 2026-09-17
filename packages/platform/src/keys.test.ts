import { describe, expect, it } from 'vitest'
import { formatShortcut, resolveShortcut } from './keys'
import { isMac } from './os'

describe('shortcuts', () => {
  it('resolves Mod to the platform modifier', () => {
    expect(resolveShortcut('Mod+Shift+P')).toBe(isMac ? 'Cmd+Shift+P' : 'Ctrl+Shift+P')
  })

  it('leaves explicit modifiers alone', () => {
    expect(resolveShortcut('Alt+Shift+5')).toBe('Alt+Shift+5')
  })

  it('formats a shortcut for display', () => {
    expect(formatShortcut('Mod+B')).toBe(isMac ? '⌘B' : 'Ctrl+B')
  })
})
