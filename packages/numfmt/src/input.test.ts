import { describe, expect, it } from 'vitest'
import { parseInput } from './input'

/**
 * What somebody typed, read as a value.
 *
 * The cases that matter are the ones where being clever is wrong. A part
 * number that looks like a date, a phone number with a leading nought, a
 * measurement in inches — every one of them is a real loss somebody has
 * suffered, and the cure is for the rule to be narrow rather than helpful.
 */

/** Fixed, so a test cannot mean different days on different machines. */
const options = { dayFirst: true, today: new Date(2026, 8, 19) }

describe('numbers', () => {
  it('reads what is plainly one', () => {
    expect(parseInput('42')).toMatchObject({ kind: 'number', value: 42 })
    expect(parseInput('-3.5')).toMatchObject({ kind: 'number', value: -3.5 })
    expect(parseInput('1e3')).toMatchObject({ kind: 'number', value: 1000 })
  })

  it('drops the separators of a number that groups its thousands', () => {
    expect(parseInput('1,234.50')).toMatchObject({ kind: 'number', value: 1234.5 })
  })

  it('leaves a string of commas alone, because it is a list and not a number', () => {
    expect(parseInput('1,2,3')).toMatchObject({ kind: 'text', value: '1,2,3' })
  })

  it('reads a percentage as the fraction it is, and formats it as one', () => {
    // 15 % is 0.15 in the cell and `15.00%` on the screen; a cell holding 15
    // would be a cell that multiplied itself by a hundred.
    expect(parseInput('15%')).toMatchObject({ kind: 'percent', value: 0.15, format: '0.00%' })
  })

  it('reads an accountant’s brackets as a negative', () => {
    expect(parseInput('(1,200)')).toMatchObject({ kind: 'number', value: -1200 })
  })

  it('gives a plain number no format of its own', () => {
    // Typing 12 into a cell showing currency leaves it currency, which is what
    // makes a formatted column usable.
    expect(parseInput('12').format).toBeNull()
  })
})

describe('the things that are not numbers however they look', () => {
  it('takes an apostrophe as the last word on the matter', () => {
    expect(parseInput("'42")).toEqual({ kind: 'text', value: '42', format: null })
    expect(parseInput("'2026-09-19")).toMatchObject({ kind: 'text', value: '2026-09-19' })
  })

  it('keeps the spaces an apostrophe was put in front of', () => {
    expect(parseInput("'  spaced")).toMatchObject({ value: '  spaced' })
  })

  it('reads the two words a spreadsheet treats as values', () => {
    expect(parseInput('true')).toMatchObject({ kind: 'boolean', value: true })
    expect(parseInput('FALSE')).toMatchObject({ kind: 'boolean', value: false })
  })

  it('reads an error somebody typed back as an error', () => {
    expect(parseInput('#N/A')).toMatchObject({ kind: 'error', value: '#N/A' })
  })

  it('leaves alone anything that is merely nearly a number', () => {
    expect(parseInput('12 inches')).toMatchObject({ kind: 'text' })
    expect(parseInput('+44 7700 900000')).toMatchObject({ kind: 'text' })
    expect(parseInput('1/2 of it')).toMatchObject({ kind: 'text' })
  })
})

describe('dates', () => {
  it('reads an ISO date, which no locale reads backwards', () => {
    // 19 September 2026.
    expect(parseInput('2026-09-19', options)).toMatchObject({ kind: 'date', value: 46_284 })
  })

  it('reads a two-number date the way the machine writes them', () => {
    const asDay = parseInput('19/09/2026', { dayFirst: true })
    const asMonth = parseInput('09/19/2026', { dayFirst: false })

    expect(asDay.value).toBe(46_284)
    expect(asMonth.value).toBe(46_284)
  })

  it('refuses a day that never happened', () => {
    // The 31st of April is a typing mistake, not the 1st of May.
    expect(parseInput('31/04/2026', options)).toMatchObject({ kind: 'text' })
  })

  it('fills in the year from today when one is left out', () => {
    const made = parseInput('19/09', options)
    expect(made).toMatchObject({ kind: 'date', value: 46_284 })
  })

  it('reads two figures of year as Excel does, with the break at thirty', () => {
    expect(parseInput('1/1/29', options).value).toBe(parseInput('1/1/2029', options).value)
    expect(parseInput('1/1/30', options).value).toBe(parseInput('1/1/1930', options).value)
  })

  it('does not take half an ISO date for a whole one', () => {
    expect(parseInput('2026-09', options)).toMatchObject({ kind: 'text' })
  })
})

describe('times', () => {
  it('reads a time as the fraction of a day it is', () => {
    expect(parseInput('12:00', options)).toMatchObject({ kind: 'time', value: 0.5 })
    expect(parseInput('06:00:00', options)).toMatchObject({ kind: 'time', value: 0.25 })
  })

  it('reads the afternoon, and the twelve o’clock that starts the day', () => {
    expect(parseInput('1:00 PM', options).value).toBeCloseTo(13 / 24)
    expect(parseInput('12:00 AM', options).value).toBe(0)
  })

  it('refuses a clock that says something no clock says', () => {
    expect(parseInput('25:00', options)).toMatchObject({ kind: 'text' })
    expect(parseInput('1:99', options)).toMatchObject({ kind: 'text' })
  })

  it('reads a date with a time after it as one moment', () => {
    const made = parseInput('2026-09-19 06:00', options)

    expect(made.kind).toBe('date')
    expect(made.value).toBeCloseTo(46_284.25)
  })
})

describe('nothing at all', () => {
  it('is empty text rather than a nought', () => {
    expect(parseInput('')).toEqual({ kind: 'text', value: '', format: null })
    expect(parseInput('   ')).toMatchObject({ kind: 'text', value: '' })
  })
})
