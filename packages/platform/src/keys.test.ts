import { describe, expect, it } from 'vitest'
import { formatShortcut, resolveShortcut } from './keys'
import { isMac } from './os'
import { baseName } from './paths'

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

describe('the path a file came from', () => {
  it('takes the last segment, whichever separator was used', () => {
    expect(baseName('/decks/talk.pptx')).toBe('talk.pptx')
    // A path can arrive from a file somebody else saved, so both are read
    // whichever system is running.
    expect(baseName('C:\\Users\\me\\talk.pptx')).toBe('talk.pptx')
  })

  it('leaves a bare name alone', () => {
    expect(baseName('talk.pptx')).toBe('talk.pptx')
  })

  it('answers with the path itself when there is no last segment', () => {
    expect(baseName('/')).toBe('/')
    expect(baseName('')).toBe('')
  })
})
