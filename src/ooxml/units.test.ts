import { describe, expect, it } from 'vitest'
import {
  formatColor,
  halfPointsToPoints,
  lineUnitsToMultiplier,
  multiplierToLineUnits,
  parseColor,
  parseIntAttribute,
  parseToggle,
  pointsToHalfPoints,
  pointsToTwips,
  twipsToPoints,
} from './units'

describe('length units', () => {
  it('converts twips to points and back', () => {
    expect(twipsToPoints(720)).toBe(36)
    expect(pointsToTwips(36)).toBe(720)
  })

  it('rounds to whole twips, the OOXML resolution', () => {
    expect(pointsToTwips(11.03)).toBe(221)
  })

  it('converts half-points to points and back', () => {
    expect(halfPointsToPoints(22)).toBe(11)
    expect(pointsToHalfPoints(11.5)).toBe(23)
  })

  it('converts line units to a multiplier and back', () => {
    expect(lineUnitsToMultiplier(240)).toBe(1)
    expect(lineUnitsToMultiplier(276)).toBe(1.15)
    expect(multiplierToLineUnits(1.15)).toBe(276)
  })
})

describe('parseIntAttribute', () => {
  it('parses an integer', () => {
    expect(parseIntAttribute('240')).toBe(240)
  })

  it('returns null rather than NaN', () => {
    expect(parseIntAttribute('abc')).toBeNull()
    expect(parseIntAttribute(undefined)).toBeNull()
  })

  it('parses a negative value, as used for hanging indents', () => {
    expect(parseIntAttribute('-360')).toBe(-360)
  })
})

describe('parseToggle', () => {
  it('treats an absent value as on', () => {
    expect(parseToggle(undefined)).toBe(true)
  })

  it('treats 0, false and off as off', () => {
    expect(parseToggle('0')).toBe(false)
    expect(parseToggle('false')).toBe(false)
    expect(parseToggle('off')).toBe(false)
  })

  it('treats 1, true and on as on', () => {
    expect(parseToggle('1')).toBe(true)
    expect(parseToggle('true')).toBe(true)
    expect(parseToggle('on')).toBe(true)
  })
})

describe('colours', () => {
  it('parses a six-digit hex colour', () => {
    expect(parseColor('FF7A00')).toBe('#FF7A00')
    expect(parseColor('ff7a00')).toBe('#FF7A00')
  })

  it('treats auto as no colour', () => {
    expect(parseColor('auto')).toBeNull()
  })

  it('rejects malformed colours instead of guessing', () => {
    expect(parseColor('xyz')).toBeNull()
    expect(parseColor('FFF')).toBeNull()
    expect(parseColor(undefined)).toBeNull()
  })

  it('formats back without the hash', () => {
    expect(formatColor('#ff7a00')).toBe('FF7A00')
  })
})
