import { dateToSerial } from './serial'

/**
 * What somebody typed, read as a value.
 *
 * The other direction of everything else here. A spreadsheet has no "type this
 * as a number" button: you type `15%` and the cell holds 0.15 with a
 * percentage format on it, you type `2026-09-19` and it holds 46 285 shown as
 * a date. Getting that wrong is how a column of dates becomes a column of
 * five-figure numbers, or a part number becomes a date — which is the most
 * famous data-loss bug in the history of the format.
 *
 * So the rule here is narrow on purpose. Something is a number, a date or a
 * time when it can only be one of those; anything else is text, and an
 * apostrophe makes anything text whatever it looks like.
 */

export type InputKind = 'number' | 'percent' | 'date' | 'time' | 'boolean' | 'error' | 'text'

export interface ParsedInput {
  kind: InputKind
  /** A serial for a date or a time, a fraction for a percentage. */
  value: number | string | boolean
  /**
   * The format the cell should take on, where typing implies one.
   *
   * Null for text and for a plain number: typing `12` into a cell formatted as
   * currency leaves it currency, which is what every spreadsheet does and what
   * makes a formatted column usable.
   */
  format: string | null
}

export interface InputOptions {
  date1904?: boolean
  /** Which way round a two-number date is read; taken from the host by default. */
  dayFirst?: boolean
  /** What year a date with no year belongs to. */
  today?: Date
}

const ERRORS = new Set([
  '#DIV/0!',
  '#N/A',
  '#NAME?',
  '#NULL!',
  '#NUM!',
  '#REF!',
  '#VALUE!',
  '#SPILL!',
  '#CALC!',
  '#GETTING_DATA',
])

/**
 * Whether this machine writes the day before the month.
 *
 * Asked of the platform rather than decided here. `19/09/2026` means different
 * days in London and in Chicago, and the one thing that knows which of them a
 * person is in is the system they are typing on.
 */
function hostPutsDayFirst(): boolean {
  try {
    const parts = new Intl.DateTimeFormat(undefined).formatToParts(new Date(2026, 8, 19))
    const day = parts.findIndex((part) => part.type === 'day')
    const month = parts.findIndex((part) => part.type === 'month')
    return day !== -1 && month !== -1 && day < month
  } catch {
    // A runtime without the full Intl data; ISO order is the safer guess,
    // since it is the one nobody reads backwards.
    return false
  }
}

export function parseInput(text: string, options: InputOptions = {}): ParsedInput {
  // Not trimmed for the apostrophe test: `'  spaced` is somebody asking for
  // those spaces, and taking them away would be answering a different request.
  if (text.startsWith("'")) return { kind: 'text', value: text.slice(1), format: null }

  const trimmed = text.trim()
  if (trimmed === '') return { kind: 'text', value: '', format: null }

  const upper = trimmed.toUpperCase()
  if (upper === 'TRUE') return { kind: 'boolean', value: true, format: null }
  if (upper === 'FALSE') return { kind: 'boolean', value: false, format: null }
  if (ERRORS.has(upper)) return { kind: 'error', value: upper, format: null }

  const number = asNumber(trimmed)
  if (number !== null) return number

  const moment = asMoment(trimmed, options)
  if (moment !== null) return moment

  return { kind: 'text', value: trimmed, format: null }
}

/** A number, a percentage, or an accountant's negative in brackets. */
function asNumber(text: string): ParsedInput | null {
  const brackets = /^\((.*)\)$/u.exec(text)
  const inner = brackets?.[1] ?? text
  const negative = brackets !== null

  const percent = inner.endsWith('%')
  const digits = (percent ? inner.slice(0, -1) : inner).trim()
  if (digits === '') return null

  // Thousands separators are dropped, and only where they group: `1,234` is a
  // number and `1,2,3` is a list of something.
  const grouped = /^[-+]?\d{1,3}(?:,\d{3})+(?:\.\d+)?$/u.test(digits)
  const plain = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/u.test(digits)
  if (!grouped && !plain) return null

  const value = Number(grouped ? digits.replace(/,/gu, '') : digits)
  if (!Number.isFinite(value)) return null

  const signed = negative ? -Math.abs(value) : value
  return percent
    ? { kind: 'percent', value: signed / 100, format: '0.00%' }
    : { kind: 'number', value: signed, format: null }
}

const MONTH_DAY = /^(\d{1,4})[./-](\d{1,2})(?:[./-](\d{1,4}))?$/u
const TIME = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?\s*(AM|PM)?$/iu

/** A date, a time, or a date with a time after it. */
function asMoment(text: string, options: InputOptions): ParsedInput | null {
  // A time first, whole: `1:00 PM` is two words and one moment, and splitting
  // it before testing would leave `PM` standing on its own.
  const alone = TIME.exec(text)
  if (alone !== null) {
    const clock = clockFrom(alone)
    return clock === null ? null : { kind: 'time', value: clock, format: 'h:mm:ss' }
  }

  const only = dateFrom(text, options)
  if (only !== null) return { kind: 'date', value: only, format: 'yyyy-mm-dd' }

  const split = text.split(/\s+/u)
  if (split.length < 2) return null

  const date = dateFrom(split[0] ?? '', options)
  const after = TIME.exec(split.slice(1).join(' '))
  if (date === null || after === null) return null

  const clock = clockFrom(after)
  return clock === null ? null : { kind: 'date', value: date + clock, format: 'yyyy-mm-dd hh:mm' }
}

function dateFrom(text: string, options: InputOptions): number | null {
  const match = MONTH_DAY.exec(text)
  if (match === null) return null

  const first = Number(match[1] ?? '')
  const second = Number(match[2] ?? '')
  const third = match[3] === undefined ? null : Number(match[3])
  if (!Number.isFinite(first) || !Number.isFinite(second)) return null

  // `2026-09-19` reads itself: a four-figure number can only be a year, and it
  // can only be at the front. A two-part ISO date is not a date at all.
  const iso = (match[1] ?? '').length === 4
  if (iso && third === null) return null

  const dayFirst = options.dayFirst ?? hostPutsDayFirst()

  const year = iso ? first : (third ?? (options.today ?? new Date()).getFullYear())
  const month = iso ? second : dayFirst ? second : first
  const day = iso ? (third ?? 1) : dayFirst ? first : second

  if (month < 1 || month > 12 || day < 1 || day > 31) return null

  // Two figures mean this century, as every spreadsheet has decided; 30 and
  // over mean the last one, which is Excel's own cut-off.
  const full = year < 100 ? (year < 30 ? 2000 + year : 1900 + year) : year

  const serial = dateToSerial({ year: full, month, day }, options.date1904)
  // A day that rolled over into the next month was never a date: 31 April is
  // a typing mistake, not the 1st of May.
  return Number.isFinite(serial) && sameDay(full, month, day) ? serial : null
}

const sameDay = (year: number, month: number, day: number): boolean => {
  const made = new Date(Date.UTC(year, month - 1, day))
  return made.getUTCMonth() === month - 1 && made.getUTCDate() === day
}

/** A time of day as a fraction of one. */
function clockFrom(match: RegExpExecArray): number | null {
  const hours = Number(match[1] ?? '')
  const minutes = Number(match[2] ?? '')
  const seconds = Number(match[3] ?? '0')
  const half = match[4]?.toUpperCase()

  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || !Number.isFinite(seconds)) return null

  if (minutes > 59 || seconds >= 60) return null
  if (half !== undefined && (hours < 1 || hours > 12)) return null
  if (half === undefined && hours > 23) return null

  const onClock = half === undefined ? hours : half === 'PM' ? (hours % 12) + 12 : hours % 12

  return (onClock * 3600 + minutes * 60 + seconds) / 86_400
}
