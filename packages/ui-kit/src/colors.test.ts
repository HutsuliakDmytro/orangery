import { describe, expect, it } from 'vitest'
import { contrastingText, isValidHex, normalizeHex } from './colors'

describe('hex handling', () => {
  it('accepts three- and six-digit hex', () => {
    expect(isValidHex('#abc')).toBe(true)
    expect(isValidHex('#AABBCC')).toBe(true)
  })

  it('rejects anything else', () => {
    expect(isValidHex('abc')).toBe(false)
    expect(isValidHex('#abcd')).toBe(false)
    expect(isValidHex('#ghijkl')).toBe(false)
    expect(isValidHex('')).toBe(false)
  })

  it('expands shorthand and upper-cases', () => {
    expect(normalizeHex('#f7a')).toBe('#FF77AA')
    expect(normalizeHex('  #ff7a00  ')).toBe('#FF7A00')
  })

  it('returns null for invalid input', () => {
    expect(normalizeHex('not a color')).toBeNull()
  })
})

describe('contrastingText', () => {
  it('puts black on light backgrounds', () => {
    expect(contrastingText('#FFFFFF')).toBe('#000000')
    expect(contrastingText('#FFFF00')).toBe('#000000')
  })

  it('puts white on dark backgrounds', () => {
    expect(contrastingText('#000000')).toBe('#FFFFFF')
    expect(contrastingText('#0000FF')).toBe('#FFFFFF')
  })

  it('falls back to black for unparseable input', () => {
    expect(contrastingText('nope')).toBe('#000000')
  })
})
