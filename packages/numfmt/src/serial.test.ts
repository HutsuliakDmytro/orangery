import { describe, expect, it } from 'vitest'
import { dateToSerial, elapsedOf, serialToDate } from './serial'

/**
 * The number a date is.
 *
 * Anchors a person can check by hand, because everything else in this package
 * is built on them being right: 1 is the 1st of January 1900, 45292 is the
 * 1st of January 2024, and 60 is a day that never happened.
 */

const on = (serial: number, date1904 = false) => serialToDate(serial, date1904)

describe('the 1900 system', () => {
  it('counts the first day of 1900 as one', () => {
    expect(on(1)).toMatchObject({ year: 1900, month: 1, day: 1 })
  })

  it('reads the dates every spreadsheet person knows by heart', () => {
    expect(on(45_292)).toMatchObject({ year: 2024, month: 1, day: 1 })
    expect(on(44_197)).toMatchObject({ year: 2021, month: 1, day: 1 })
  })

  it('keeps the day that never happened, because every file counts it', () => {
    // Lotus had the bug, Excel copied it on purpose, and serial 60 has been
    // the 29th of February 1900 ever since — a date with no day behind it.
    expect(on(60)).toMatchObject({ year: 1900, month: 2, day: 29 })
    expect(on(59)).toMatchObject({ year: 1900, month: 2, day: 28 })
    expect(on(61)).toMatchObject({ year: 1900, month: 3, day: 1 })
  })

  it('counts weekdays as WEEKDAY does, from Sunday', () => {
    // The 1st of January 2024 was a Monday.
    expect(on(45_292)?.weekday).toBe(1)
  })

  it('has no date for a negative number, in either system', () => {
    expect(on(-1)).toBeNull()
    expect(on(-1, true)).toBeNull()
  })
})

describe('the 1904 system', () => {
  it('counts from a different day, so the same number is a different date', () => {
    // Four years and a day apart, which is why a workbook states which system
    // it uses and why copying cells between the two shifts every date.
    expect(on(0, true)).toMatchObject({ year: 1904, month: 1, day: 1 })
    expect(on(45_292, true)).toMatchObject({ year: 2028, month: 1, day: 2 })
  })

  it('has no phantom day, because the bug was not copied into it', () => {
    expect(on(60, true)).toMatchObject({ year: 1904, month: 3, day: 1 })
  })
})

describe('the time of day', () => {
  it('reads the fraction as the clock', () => {
    expect(on(45_292.5)).toMatchObject({ hours: 12, minutes: 0, seconds: 0 })
    expect(on(45_292.75)).toMatchObject({ hours: 18, minutes: 0 })
  })

  it('rounds rather than truncates, or every third of a day is a second early', () => {
    // A third of a day is 8:00:00 and stored as 0.333333333333333; flooring
    // the seconds shows 7:59:59 for a time somebody typed.
    expect(on(0.333_333_333_333_333)).toMatchObject({ hours: 8, minutes: 0, seconds: 0 })

    // Rounded to the millisecond and no further: whether 23:59:59.914 shows
    // as midnight is a question about the format's own precision, and it is
    // asked where the formatting happens rather than here.
    expect(on(0.999_999)).toMatchObject({ hours: 23, minutes: 59, seconds: 59 })
  })

  it('keeps the thousandths apart, so a format can show or drop them', () => {
    // A millisecond is a 86,400,000th of a day, which is past what a literal
    // can spell exactly — so it is written as the division it is.
    expect(on(45_292.5 + 1 / 86_400_000)?.milliseconds).toBe(1)
  })
})

describe('back the other way', () => {
  it('writes a date as the number the file keeps', () => {
    expect(dateToSerial({ year: 2024, month: 1, day: 1 })).toBe(45_292)
    expect(dateToSerial({ year: 1900, month: 1, day: 1 })).toBe(1)
  })

  it('steps over the day that never happened, as the file does', () => {
    expect(dateToSerial({ year: 1900, month: 3, day: 1 })).toBe(61)
  })

  it('writes the time into the fraction', () => {
    expect(dateToSerial({ year: 2024, month: 1, day: 1, hours: 12 })).toBe(45_292.5)
  })

  it('reads back whatever it wrote', () => {
    for (const serial of [1, 59, 61, 1000, 45_292, 45_292.25]) {
      const parts = serialToDate(serial)
      if (parts === null) throw new Error('no date')
      expect(dateToSerial(parts)).toBeCloseTo(serial, 6)
    }
  })
})

describe('a length of time rather than a moment', () => {
  it('does not wrap, which is the whole point of the brackets', () => {
    // `[h]:mm` on 1.5 is 36:00, not noon on the first day — it is how a
    // workbook adds up a week of hours.
    expect(elapsedOf(1.5)).toMatchObject({ hours: 36, minutes: 2160 })
  })

  it('counts minutes and seconds the same way', () => {
    expect(elapsedOf(1 / 24 + 1 / 1440)).toMatchObject({ hours: 1, minutes: 61, seconds: 3660 })
  })

  it('remembers that a duration can be negative', () => {
    expect(elapsedOf(-0.5)).toMatchObject({ hours: 12, negative: true })
  })
})
