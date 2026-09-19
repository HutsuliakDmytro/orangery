import { describe, expect, it } from 'vitest'
import { parseTypedNumber } from './typed-number'

describe('a number somebody typed', () => {
  it('reads the plain ones', () => {
    expect(parseTypedNumber('42')).toBe(42)
    expect(parseTypedNumber('1.5')).toBe(1.5)
    expect(parseTypedNumber('-3.25')).toBe(-3.25)
  })

  it('reads a comma as the decimal point, which is how half the world types', () => {
    // `Number('1,5')` is NaN, and a chart editor that handed the text straight
    // over would swallow the number without saying anything.
    expect(parseTypedNumber('1,5')).toBe(1.5)
    expect(parseTypedNumber('-0,75')).toBe(-0.75)
  })

  it('reads grouping spaces, including the ones a keyboard never types', () => {
    expect(parseTypedNumber('1 234,5')).toBe(1234.5)
    expect(parseTypedNumber('1 234.5')).toBe(1234.5)
    expect(parseTypedNumber('1 234')).toBe(1234)
  })

  it('lets the last separator decide, which is what makes it the decimal one', () => {
    expect(parseTypedNumber('1,234.5')).toBe(1234.5)
    expect(parseTypedNumber('1.234,5')).toBe(1234.5)
  })

  it('reads nothing at all as a gap rather than as a nought', () => {
    // A nought is a bar of no height; a gap is no bar at all.
    expect(parseTypedNumber('')).toBeNull()
    expect(parseTypedNumber('   ')).toBeNull()
  })

  it('refuses what is not a number, rather than quietly making one up', () => {
    expect(parseTypedNumber('abc')).toBeUndefined()
    expect(parseTypedNumber('1.2.3.4x')).toBeUndefined()
    expect(parseTypedNumber('--5')).toBeUndefined()
  })

  it('reads the forms a spreadsheet writes back out', () => {
    expect(parseTypedNumber('1e3')).toBe(1000)
    expect(parseTypedNumber('0.0001')).toBe(0.0001)
  })
})
