import { describe, expect, it } from 'vitest'
import { resolveColor } from './color'
import { fontStackFor, parseTheme, resolveThemeFont } from './theme'

const THEME = `<a:theme xmlns:a="x" name="Office">
  <a:themeElements>
    <a:clrScheme name="Office">
      <a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1>
      <a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1>
      <a:accent1><a:srgbClr val="4F81BD"/></a:accent1>
    </a:clrScheme>
    <a:fontScheme name="Office">
      <a:majorFont><a:latin typeface="Cambria"/></a:majorFont>
      <a:minorFont><a:latin typeface="Calibri"/></a:minorFont>
    </a:fontScheme>
  </a:themeElements>
</a:theme>`

describe('parseTheme', () => {
  it('reads the palette by slot', () => {
    const theme = parseTheme(THEME)

    expect([...theme.colors.keys()]).toEqual(['dk1', 'lt1', 'accent1'])
    expect(theme.colors.get('accent1')?.source).toEqual({ kind: 'srgb', hex: '#4F81BD' })
  })

  it('reads the two typefaces', () => {
    expect(parseTheme(THEME).fonts).toEqual({ major: 'Cambria', minor: 'Calibri' })
  })

  it('names the theme, which is what a theme gallery shows', () => {
    expect(parseTheme(THEME).name).toBe('Office')
  })

  it('survives a theme with no elements at all', () => {
    expect(parseTheme('<a:theme xmlns:a="x"/>').fonts).toEqual({ major: null, minor: null })
    expect(parseTheme('<nope/>').colors.size).toBe(0)
  })

  it('reads a palette the colour resolver can then use', () => {
    const theme = parseTheme(THEME)
    const accent = theme.colors.get('accent1')

    expect(
      accent === undefined
        ? null
        : resolveColor(accent, { scheme: theme.colors, map: new Map() })?.hex,
    ).toBe('#4F81BD')
  })
})

describe('resolveThemeFont', () => {
  const fonts = parseTheme(THEME).fonts

  it('understands how a document spells the reference', () => {
    expect(resolveThemeFont(fonts, 'majorHAnsi')).toBe('Cambria')
    expect(resolveThemeFont(fonts, 'minorHAnsi')).toBe('Calibri')
  })

  it('understands how a deck spells it', () => {
    // Same two slots, different notation: `+mj-lt` and `+mn-lt`.
    expect(resolveThemeFont(fonts, '+mj-lt')).toBe('Cambria')
    expect(resolveThemeFont(fonts, '+mn-lt')).toBe('Calibri')
  })

  it('is null when nothing is referenced', () => {
    expect(resolveThemeFont(fonts, undefined)).toBeNull()
  })
})

describe('fontStackFor', () => {
  it('puts the named family first, then its metric twin', () => {
    expect(fontStackFor('Calibri')).toBe(
      'Calibri, Carlito, "Liberation Sans", Helvetica, Arial, sans-serif'.replace(/"/gu, "'"),
    )
  })

  it('ends in a generic that suits the family', () => {
    expect(fontStackFor('Courier New').endsWith('monospace')).toBe(true)
    expect(fontStackFor('Cambria').endsWith('serif')).toBe(true)
    expect(fontStackFor('Unknown Sans').endsWith('sans-serif')).toBe(true)
  })

  it('quotes a family whose name needs it', () => {
    expect(fontStackFor('Times New Roman')).toContain("'Times New Roman'")
  })

  it('still produces a usable stack for a family it knows nothing about', () => {
    // A file may name any font at all, and it still has to render.
    expect(fontStackFor('Grobenhaus Display')).toBe("'Grobenhaus Display', sans-serif")
  })

  it('gives symbol fonts a fallback that renders something', () => {
    // There is no metric equivalent for these; the goal is a glyph rather than
    // a tofu box, because they carry bullet characters.
    expect(fontStackFor('Wingdings')).toContain('Apple Symbols')
    expect(fontStackFor('Symbol')).toContain('Segoe UI Symbol')
  })
})
