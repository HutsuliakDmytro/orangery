import { describe, expect, it } from 'vitest'
import { formatGeneral, formatValue } from './format'

/**
 * A value, shown the way its format says.
 *
 * Every expectation here is what Excel shows for the same pair, because that
 * is the only bar that matters: a format is right when the cell looks like it
 * looked in the program the file came from.
 */

const shown = (value: number | string | null, code: string | null, date1904 = false): string =>
  formatValue(value, code, { date1904 }).text

describe('General, which is what a cell has when it has none', () => {
  it('shows a whole number as itself', () => {
    expect(formatGeneral(0)).toBe('0')
    expect(formatGeneral(42)).toBe('42')
    expect(formatGeneral(-7)).toBe('-7')
  })

  it('shows a fraction without the zeros nobody typed', () => {
    expect(formatGeneral(1.5)).toBe('1.5')
    expect(formatGeneral(0.1)).toBe('0.1')
  })

  it('turns to scientific where a number cannot be shown otherwise', () => {
    expect(formatGeneral(1e15)).toContain('E+')
    expect(formatGeneral(0.000_000_000_001)).toContain('E-')
  })
})

describe('places and padding', () => {
  it('rounds the picture rather than the value', () => {
    // The cell keeps every digit it had, which is why a column of rounded
    // numbers still adds up to what it adds up to.
    expect(shown(1.005, '0.00')).toBe('1.01')
    expect(shown(2.675, '0.00')).toBe('2.68')
  })

  it('keeps the zeros a format asks for and drops the ones it does not', () => {
    expect(shown(1.5, '0.00')).toBe('1.50')
    expect(shown(1.5, '0.##')).toBe('1.5')
    expect(shown(1, '0.##')).toBe('1')
  })

  it('shows every digit a number has, however few the format states', () => {
    expect(shown(1234, '0')).toBe('1234')
    expect(shown(1234, '#')).toBe('1234')
  })

  it('groups thousands where the format asks', () => {
    expect(shown(1_234_567, '#,##0')).toBe('1,234,567')
    expect(shown(1234, '#,##0.00')).toBe('1,234.00')
  })
})

describe('the punctuation that does arithmetic', () => {
  it('multiplies by a hundred for a percent', () => {
    expect(shown(0.15, '0%')).toBe('15%')
    expect(shown(0.1234, '0.0%')).toBe('12.3%')
  })

  it('divides by a thousand for each trailing comma', () => {
    expect(shown(1_234_567, '#,##0,')).toBe('1,235')
    expect(shown(1_234_567_890, '0.0,,')).toBe('1234.6')
  })
})

describe('sections', () => {
  it('uses the second for negatives, which supplies its own sign', () => {
    expect(shown(-1234, '#,##0;(#,##0)')).toBe('(1,234)')
    expect(shown(1234, '#,##0;(#,##0)')).toBe('1,234')
  })

  it('writes the minus itself when the format states no negative section', () => {
    expect(shown(-5, '0.0')).toBe('-5.0')
  })

  it('uses the third for zero', () => {
    expect(shown(0, '0.0;-0.0;"—"')).toBe('—')
  })

  it('uses the fourth for text', () => {
    expect(shown('hello', '0.0;-0.0;"—";"[" @ "]"')).toBe('[ hello ]')
  })

  it('follows the conditions where a format states them', () => {
    const code = '[>=100]"big";[<0]"under";0'

    expect(shown(150, code)).toBe('big')
    expect(shown(-2, code)).toBe('under')
    expect(shown(5, code)).toBe('5')
  })

  it('hands back the colour the section asks for', () => {
    expect(formatValue(-5, '0;[Red]-0').color).toBe('Red')
    expect(formatValue(5, '0;[Red]-0').color).toBeNull()
  })
})

describe('literals around the number', () => {
  it('keeps a quoted run where it was written', () => {
    expect(shown(5, '0" kg"')).toBe('5 kg')
    expect(shown(5, '"total: "0')).toBe('total: 5')
  })

  it('writes a currency symbol from the brackets', () => {
    expect(shown(1234.5, '[$€-407]#,##0.00')).toBe('€1,234.50')
  })

  it('turns a pad into the space it stands for', () => {
    expect(shown(5, '0_)')).toBe('5 ')
  })

  it('hands the fill character to whoever knows the column width', () => {
    expect(formatValue(5, '0*-').fill).toBe('-')
  })
})

describe('dates', () => {
  // 45292.5 is noon on the 1st of January 2024, a Monday.
  const noon = 45_292.5

  it('shows the parts a format asks for', () => {
    expect(shown(noon, 'yyyy-mm-dd')).toBe('2024-01-01')
    expect(shown(noon, 'd/m/yyyy')).toBe('1/1/2024')
    expect(shown(noon, 'dd.mm.yy')).toBe('01.01.24')
  })

  it('names months and days as the number of letters asks', () => {
    expect(shown(noon, 'mmm d, yyyy')).toBe('Jan 1, 2024')
    expect(shown(noon, 'mmmm')).toBe('January')
    expect(shown(noon, 'ddd')).toBe('Mon')
    expect(shown(noon, 'dddd')).toBe('Monday')
  })

  it('tells a minute from a month by its neighbours', () => {
    // The one rule in this language that cannot be decided by looking at the
    // token alone: `m` after an hour is minutes.
    expect(shown(noon, 'h:mm')).toBe('12:00')
    expect(shown(noon, 'mm/dd')).toBe('01/01')
  })

  it('shows a twelve-hour clock where the format says so', () => {
    expect(shown(45_292.75, 'h:mm AM/PM')).toBe('6:00 PM')
    expect(shown(45_292.25, 'h:mm AM/PM')).toBe('6:00 AM')
    expect(shown(45_292.75, 'h:mm')).toBe('18:00')
  })

  it('counts elapsed time past its own wrap', () => {
    // `[h]:mm` on a day and a half is 36 hours, not noon.
    expect(shown(1.5, '[h]:mm')).toBe('36:00')
    expect(shown(1.5, '[mm]')).toBe('2160')
  })

  it('reads the same number differently in the 1904 system', () => {
    expect(shown(45_292, 'yyyy-mm-dd', true)).toBe('2028-01-02')
  })

  it('shows the day that never happened, because the file counts it', () => {
    expect(shown(60, 'yyyy-mm-dd')).toBe('1900-02-29')
  })
})

describe('a text cell', () => {
  it('goes where the placeholder is', () => {
    expect(shown('Q1', '@" total"')).toBe('Q1 total')
  })

  it('is shown as itself where the format says nothing about text', () => {
    expect(shown('Q1', '#,##0.00')).toBe('Q1')
  })
})

describe('a cell with nothing in it', () => {
  it('shows nothing, whatever the format says', () => {
    expect(shown(null, '#,##0.00')).toBe('')
    expect(shown(null, null)).toBe('')
  })
})
