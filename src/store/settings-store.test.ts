import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS, effectiveTheme, parseSettings } from './settings-store'

describe('parseSettings', () => {
  it('reads settings it wrote', () => {
    const settings = { ...DEFAULT_SETTINGS, theme: 'light' as const, language: 'uk' as const }
    expect(parseSettings(JSON.stringify(settings))).toEqual(settings)
  })

  it('falls back to defaults for malformed JSON', () => {
    expect(parseSettings('nonsense')).toEqual(DEFAULT_SETTINGS)
  })

  it('falls back to defaults for a non-object', () => {
    expect(parseSettings('42')).toEqual(DEFAULT_SETTINGS)
    expect(parseSettings('null')).toEqual(DEFAULT_SETTINGS)
  })

  it('rejects an unknown theme', () => {
    expect(parseSettings('{"theme":"neon"}').theme).toBe(DEFAULT_SETTINGS.theme)
  })

  it('rejects an unsupported language', () => {
    expect(parseSettings('{"language":"fr"}').language).toBe('en')
  })

  it('accepts the languages the app ships', () => {
    expect(parseSettings('{"language":"uk"}').language).toBe('uk')
    expect(parseSettings('{"language":"en"}').language).toBe('en')
  })

  it('rejects a font size that is not a positive number', () => {
    expect(parseSettings('{"defaultFontSize":0}').defaultFontSize).toBe(
      DEFAULT_SETTINGS.defaultFontSize,
    )
    expect(parseSettings('{"defaultFontSize":"big"}').defaultFontSize).toBe(
      DEFAULT_SETTINGS.defaultFontSize,
    )
  })

  it('rejects an empty font family', () => {
    expect(parseSettings('{"defaultFontFamily":""}').defaultFontFamily).toBe(
      DEFAULT_SETTINGS.defaultFontFamily,
    )
  })

  it('keeps booleans it recognises', () => {
    expect(parseSettings('{"autosaveEnabled":false}').autosaveEnabled).toBe(false)
    expect(parseSettings('{"keepBackups":false}').keepBackups).toBe(false)
  })

  it('defaults dark, as the design system specifies', () => {
    expect(DEFAULT_SETTINGS.theme).toBe('dark')
  })
})

describe('effectiveTheme', () => {
  it('passes an explicit preference through', () => {
    expect(effectiveTheme('dark')).toBe('dark')
    expect(effectiveTheme('light')).toBe('light')
  })

  it('resolves system against the OS preference', () => {
    expect(['dark', 'light']).toContain(effectiveTheme('system'))
  })

  it('falls back to dark when the OS cannot be asked', () => {
    // jsdom has no matchMedia, and neither do some older webviews.
    expect(effectiveTheme('system')).toBe('dark')
  })
})
