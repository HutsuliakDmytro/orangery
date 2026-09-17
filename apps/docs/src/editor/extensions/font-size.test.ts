import { describe, expect, it } from 'vitest'
import { clampFontSize, DEFAULT_FONT_SIZE, MAX_FONT_SIZE, parseFontSize } from './font-size'

describe('clampFontSize', () => {
  it('rounds to the nearest half point, the OOXML resolution', () => {
    expect(clampFontSize(11.3)).toBe(11.5)
    expect(clampFontSize(11.1)).toBe(11)
  })

  it('clamps to the range Word accepts', () => {
    expect(clampFontSize(0)).toBe(1)
    expect(clampFontSize(-40)).toBe(1)
    expect(clampFontSize(99999)).toBe(MAX_FONT_SIZE)
  })

  it('falls back to the default for non-finite input', () => {
    expect(clampFontSize(Number.NaN)).toBe(DEFAULT_FONT_SIZE)
    expect(clampFontSize(Number.POSITIVE_INFINITY)).toBe(DEFAULT_FONT_SIZE)
  })
})

describe('parseFontSize', () => {
  it('reads a pt value from a style string', () => {
    expect(parseFontSize('14pt')).toBe(14)
    expect(parseFontSize(' 10.5 pt ')).toBe(10.5)
  })

  it('ignores units it cannot map to points', () => {
    expect(parseFontSize('14px')).toBeNull()
    expect(parseFontSize('1.2em')).toBeNull()
    expect(parseFontSize(null)).toBeNull()
    expect(parseFontSize('')).toBeNull()
  })
})
