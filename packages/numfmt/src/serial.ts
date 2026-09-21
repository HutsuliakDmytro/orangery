/**
 * The number a date is.
 *
 * A spreadsheet has no date type: 2026-09-19 is 46284, the count of days since
 * an epoch, and the time of day is the fraction after the point. Everything
 * else about dates in a workbook follows from that, including the two things
 * that make it awkward.
 *
 * **1900 was not a leap year, and Excel says it was.** Lotus 1-2-3 had the bug
 * first, Excel copied it for compatibility, and every file since has counted
 * 60 as the 29th of February 1900 — a day that did not happen. Serial 61 is
 * the 1st of March, and the arithmetic only works if the epoch is taken as the
 * 30th of December 1899 and serials below 61 are left to the bug.
 *
 * **Mac Excel once counted from 1904.** A workbook says which system it uses,
 * and the same number means dates four years apart in the two of them.
 */

export interface DateParts {
  year: number
  /** 1 to 12, as a person counts them. */
  month: number
  day: number
  hours: number
  minutes: number
  seconds: number
  /** Thousandths, kept apart so a format can show or drop them. */
  milliseconds: number
  /** 0 is Sunday, as `WEEKDAY` counts by default. */
  weekday: number
}

const DAY_MS = 86_400_000

/** The 30th of December 1899, which is serial 0 in the 1900 system. */
const EPOCH_1900 = Date.UTC(1899, 11, 30)

/** The 1st of January 1904, which is serial 0 in the other one. */
const EPOCH_1904 = Date.UTC(1904, 0, 1)

/**
 * The serial as the day and time it stands for.
 *
 * Null for a number no date can be made of: negatives have no date in either
 * system, and neither does anything past the year 9999, which is where Excel
 * itself stops.
 */
export function serialToDate(serial: number, date1904 = false): DateParts | null {
  if (!Number.isFinite(serial) || serial < 0) return null

  // The phantom 29th of February 1900. Serials below it are a day ahead of
  // the truth, which is the bug; 60 itself is the day that never happened.
  const phantom = !date1904 && serial < 61
  const days = Math.floor(serial)
  const epoch = date1904 ? EPOCH_1904 : EPOCH_1900

  if (!date1904 && days === 60) {
    return { ...timeOf(serial), year: 1900, month: 2, day: 29, weekday: 3 }
  }

  const shifted = phantom ? days + 1 : days
  const milliseconds = epoch + shifted * DAY_MS
  if (Number.isNaN(milliseconds)) return null

  const date = new Date(milliseconds)
  if (date.getUTCFullYear() > 9999) return null

  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
    ...timeOf(serial),
  }
}

/**
 * The time of day a serial's fraction stands for, rounded to the millisecond.
 *
 * Rounded rather than truncated because a third of a day is 8:00:00 and stored
 * as 0.333333333333333, and truncating shows 7:59:59 — which is what a reader
 * that floors the seconds shows for every time somebody typed.
 */
function timeOf(serial: number): Pick<DateParts, 'hours' | 'minutes' | 'seconds' | 'milliseconds'> {
  const fraction = serial - Math.floor(serial)
  const total = Math.round(fraction * DAY_MS)

  return {
    hours: Math.floor(total / 3_600_000) % 24,
    minutes: Math.floor(total / 60_000) % 60,
    seconds: Math.floor(total / 1000) % 60,
    milliseconds: total % 1000,
  }
}

/** A date as the number a workbook keeps it as. */
export function dateToSerial(
  parts: Partial<DateParts> & { year: number; month: number; day: number },
  date1904 = false,
): number {
  const epoch = date1904 ? EPOCH_1904 : EPOCH_1900
  const utc = Date.UTC(parts.year, parts.month - 1, parts.day)
  const days = Math.round((utc - epoch) / DAY_MS)

  // The epoch already counts the day that never happened, which is why it is
  // the 30th of December and not the 31st. Dates before the 1st of March 1900
  // are the other side of it and come out one too high.
  const shifted = !date1904 && days < 61 ? days - 1 : days
  const time =
    ((parts.hours ?? 0) * 3_600_000 +
      (parts.minutes ?? 0) * 60_000 +
      (parts.seconds ?? 0) * 1000 +
      (parts.milliseconds ?? 0)) /
    DAY_MS

  return shifted + time
}

/** How long a duration is, for the formats that show elapsed time. */
export interface Elapsed {
  hours: number
  minutes: number
  seconds: number
  milliseconds: number
  negative: boolean
}

/**
 * A serial as a length of time rather than a moment.
 *
 * `[h]:mm` on 1.5 is 36:00, not noon on the first day: the brackets say the
 * unit does not wrap, which is how a workbook adds up a week of hours.
 */
export function elapsedOf(serial: number): Elapsed {
  const negative = serial < 0
  const total = Math.round(Math.abs(serial) * DAY_MS)

  return {
    hours: Math.floor(total / 3_600_000),
    minutes: Math.floor(total / 60_000),
    seconds: Math.floor(total / 1000),
    milliseconds: total % 1000,
    negative,
  }
}
