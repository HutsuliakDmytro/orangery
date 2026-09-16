import { describe, expect, it } from 'vitest'
import { fontStackFor, parseFontTable, parseThemeFonts, resolveThemeFont } from './fonts'

const THEME = `<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <a:themeElements><a:fontScheme name="Office">
    <a:majorFont><a:latin typeface="Cambria"/></a:majorFont>
    <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
  </a:fontScheme></a:themeElements>
</a:theme>`

describe('parseThemeFonts', () => {
  it('reads the heading and body fonts', () => {
    expect(parseThemeFonts(THEME)).toEqual({ major: 'Cambria', minor: 'Calibri' })
  })

  it('returns nulls for a theme without a font scheme', () => {
    expect(parseThemeFonts('<a:theme xmlns:a="x"/>')).toEqual({ major: null, minor: null })
  })

  it('returns nulls rather than throwing on nonsense', () => {
    expect(parseThemeFonts('<nope/>')).toEqual({ major: null, minor: null })
  })
})

describe('resolveThemeFont', () => {
  const theme = parseThemeFonts(THEME)

  it('maps major slots to the heading font', () => {
    expect(resolveThemeFont(theme, 'majorHAnsi')).toBe('Cambria')
  })

  it('maps minor slots to the body font', () => {
    expect(resolveThemeFont(theme, 'minorHAnsi')).toBe('Calibri')
  })

  it('returns null when no slot is named', () => {
    expect(resolveThemeFont(theme, undefined)).toBeNull()
  })
})

describe('fontStackFor', () => {
  it('puts the named family first, so an installed font wins', () => {
    expect(fontStackFor('Calibri').startsWith('Calibri,')).toBe(true)
  })

  it('offers metric-compatible substitutes', () => {
    expect(fontStackFor('Calibri')).toContain('Carlito')
    expect(fontStackFor('Cambria')).toContain('Caladea')
    expect(fontStackFor('Times New Roman')).toContain('Liberation Serif')
  })

  it('ends with a generic family', () => {
    expect(fontStackFor('Calibri').endsWith('sans-serif')).toBe(true)
    expect(fontStackFor('Cambria').endsWith('serif')).toBe(true)
    expect(fontStackFor('Courier New').endsWith('monospace')).toBe(true)
  })

  it('quotes families with spaces', () => {
    expect(fontStackFor('Times New Roman')).toContain("'Times New Roman'")
  })

  it('handles a family it knows nothing about', () => {
    const stack = fontStackFor('Bodoni Ornaments')
    expect(stack).toContain("'Bodoni Ornaments'")
    expect(stack.endsWith('sans-serif')).toBe(true)
  })

  it('gives symbol fonts a fallback that renders something', () => {
    expect(fontStackFor('Wingdings')).toContain('Apple Symbols')
  })
})

describe('parseFontTable', () => {
  it('lists every family the document declares', () => {
    const xml = '<w:fonts xmlns:w="x"><w:font w:name="Calibri"/><w:font w:name="Symbol"/></w:fonts>'
    expect(parseFontTable(xml)).toEqual(['Calibri', 'Symbol'])
  })

  it('returns an empty list for malformed input', () => {
    expect(parseFontTable('<nope/>')).toEqual([])
  })
})
