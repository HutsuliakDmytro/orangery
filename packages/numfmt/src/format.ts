import { parseFormat, isTwelveHour } from './parse'
import type { NumberFormat, Section, Token } from './parse'
import { elapsedOf, serialToDate } from './serial'

/**
 * A value, shown the way its format says.
 *
 * The number is the truth and this is the picture: a cell holds 0.15 and shows
 * "15%", holds 45292 and shows "1 Jan 2024". Nothing here changes the value —
 * a format that rounds to two places rounds the picture, and the cell keeps
 * every digit it had, which is why a column of rounded numbers still adds up
 * to what it adds up to.
 */

export interface FormatOptions {
  /** Dates counted from 1904, as the workbook states. */
  date1904?: boolean
  /** Month and day names; English is what the format codes assume. */
  locale?: Names
}

export interface Names {
  months: readonly string[]
  monthsShort: readonly string[]
  days: readonly string[]
  daysShort: readonly string[]
  am: string
  pm: string
}

const ENGLISH: Names = {
  months: [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
  ],
  monthsShort: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  daysShort: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  am: 'AM',
  pm: 'PM',
}

export interface Formatted {
  text: string
  /** What the section asked for, as written; the caller decides what red is. */
  color: string | null
  /** `*-` asks for the rest of the cell to be filled, which only a grid can do. */
  fill: string | null
}

const holds = (section: Section, kind: Token['kind']): boolean =>
  section.tokens.some((token) => token.kind === kind)

/**
 * Which section a value is shown by.
 *
 * Without conditions the order is fixed: positive, negative, zero, text — and
 * a format with fewer sections spreads them, so one section serves every
 * number and two split it at zero. With conditions the sections are tried in
 * order and the last unconditional one is the else, which is why `[>100]` and
 * `[<0]` can be followed by a plain third.
 */
function sectionFor(
  format: NumberFormat,
  value: number | string,
): { section: Section; signed: boolean } | null {
  const sections = format.sections
  if (sections.length === 0) return null

  if (typeof value === 'string') {
    // A text section is the fourth, or the only one that mentions text at all.
    const text = sections[3] ?? sections.find((section) => holds(section, 'text'))
    return text === undefined ? null : { section: text, signed: false }
  }

  const conditional = sections.filter((section) => section.condition !== null)
  if (conditional.length > 0) {
    const matched = conditional.find((section) => matches(section.condition, value))
    const chosen = matched ?? sections.find((section) => section.condition === null)
    // A section chosen by its condition writes whatever sign it wants: a
    // format that says `[<0]"under"` is not asking for a minus as well.
    return chosen === undefined ? null : { section: chosen, signed: matched !== undefined }
  }

  const [positive, negative, zero] = sections
  if (value < 0 && negative !== undefined) {
    // The negative section is shown the value without its sign, because the
    // section is what the sign looks like — often brackets rather than a dash.
    return { section: negative, signed: true }
  }
  if (value === 0 && zero !== undefined) return { section: zero, signed: false }
  return positive === undefined ? null : { section: positive, signed: false }
}

function matches(condition: Section['condition'], value: number): boolean {
  if (condition === null) return false

  switch (condition.operator) {
    case '<':
      return value < condition.value
    case '<=':
      return value <= condition.value
    case '>':
      return value > condition.value
    case '>=':
      return value >= condition.value
    case '=':
      return value === condition.value
    case '<>':
      return value !== condition.value
  }
}

/** How many digits a section asks for on each side of the point. */
function digitCounts(tokens: readonly Token[]): {
  integer: number
  decimals: number
  minimumDecimals: number
  grouped: boolean
} {
  let integer = 0
  let decimals = 0
  let minimumDecimals = 0
  let afterPoint = false
  let grouped = false

  for (const token of tokens) {
    if (token.kind === 'decimal') {
      afterPoint = true
      continue
    }
    if (token.kind === 'group') {
      grouped = true
      continue
    }
    if (token.kind !== 'digit') continue

    if (afterPoint) {
      decimals += 1
      if (token.placeholder === '0') minimumDecimals = decimals
    } else {
      integer += 1
    }
  }

  return { integer, decimals, minimumDecimals, grouped }
}

const groupThousands = (digits: string): string => digits.replace(/\B(?=(?:\d{3})+(?!\d))/gu, ',')

/**
 * The digits of a number, rounded to the places the format asks for.
 *
 * Rounded half away from zero, as Excel does and as JavaScript does not:
 * `toFixed` rounds half to even in some engines and to the nearest
 * representable double in all of them, and 1.005 is the example everybody
 * meets.
 */
function digitsOf(value: number, decimals: number): { whole: string; fraction: string } {
  const factor = 10 ** decimals
  const scaled = Math.round(Math.abs(value) * factor + Number.EPSILON * Math.abs(value) * factor)
  const text = (scaled / factor).toFixed(decimals)
  const [whole = '0', fraction = ''] = text.split('.')

  return { whole, fraction }
}

/**
 * The shortest fraction within the denominator the format allows.
 *
 * `# ?/?` gives a denominator of one digit and `# ??/??` two; `?/16` fixes it.
 * Walked rather than solved: the denominators are at most three digits, and a
 * continued fraction here would be a clever way to get the same answer.
 */
function fractionOf(
  value: number,
  denominatorDigits: number,
  fixed: number | null,
): {
  whole: number
  numerator: number
  denominator: number
} {
  const whole = Math.trunc(value)
  const rest = Math.abs(value - whole)
  const limit = fixed ?? 10 ** denominatorDigits - 1

  if (fixed !== null) {
    return { whole, numerator: Math.round(rest * fixed), denominator: fixed }
  }

  let best = { numerator: 0, denominator: 1, error: rest }
  for (let denominator = 1; denominator <= limit; denominator += 1) {
    const numerator = Math.round(rest * denominator)
    const error = Math.abs(rest - numerator / denominator)
    if (error < best.error - 1e-12) best = { numerator, denominator, error }
  }

  return { whole, numerator: best.numerator, denominator: best.denominator }
}

/**
 * `General` — the format a cell has when it has none.
 *
 * Excel fits the number into about eleven characters: plain where it can,
 * scientific where the number is too big or too small to show otherwise. The
 * exact rule involves the column's width, which nothing here knows, so this is
 * the width-independent part of it.
 */
export function formatGeneral(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'

  const magnitude = Math.abs(value)
  if (magnitude >= 1e11 || magnitude < 1e-10) {
    const text = value
      .toExponential(5)
      .replace(/e([+-])(\d)$/u, 'E$10$2')
      .replace(/e/u, 'E')
    return text.replace(/(\.\d*?)0+E/u, '$1E').replace(/\.E/u, 'E')
  }

  // Eleven significant digits, with the trailing zeros a rounding leaves.
  const text = value.toPrecision(11)
  return text.includes('.') ? text.replace(/\.?0+$/u, '') : text
}

const padded = (value: number, length: number): string => String(value).padStart(length, '0')

function dateText(
  code: string,
  parts: NonNullable<ReturnType<typeof serialToDate>>,
  twelveHour: boolean,
  names: Names,
  fraction: number,
): string {
  const lower = code.toLowerCase()

  switch (lower[0]) {
    case 'y':
      return lower.length <= 2 ? padded(parts.year % 100, 2) : String(parts.year)
    case 'm':
      return monthText(lower, parts, names)
    case 'd':
      if (lower.length === 1) return String(parts.day)
      if (lower.length === 2) return padded(parts.day, 2)
      return lower.length === 3
        ? (names.daysShort[parts.weekday] ?? '')
        : (names.days[parts.weekday] ?? '')
    case 'h': {
      const hour = twelveHour ? parts.hours % 12 || 12 : parts.hours
      return lower.length === 1 ? String(hour) : padded(hour, 2)
    }
    case 's': {
      const seconds = parts.seconds
      const text = lower.length === 1 ? String(seconds) : padded(seconds, 2)
      return fraction > 0
        ? `${text}.${padded(Math.round(parts.milliseconds / 10 ** (3 - fraction)), fraction)}`
        : text
    }
    case 'a':
      return parts.hours < 12 ? names.am : names.pm
    default:
      return ''
  }
}

/**
 * A month, or the minutes that are spelled the same way.
 *
 * The letter is decided by its neighbours before this is reached; what is left
 * here is how many of them there are.
 */
function monthText(
  code: string,
  parts: NonNullable<ReturnType<typeof serialToDate>>,
  names: Names,
): string {
  switch (code.length) {
    case 1:
      return String(parts.month)
    case 2:
      return padded(parts.month, 2)
    case 3:
      return names.monthsShort[parts.month - 1] ?? ''
    case 5:
      return (names.months[parts.month - 1] ?? '').slice(0, 1)
    default:
      return names.months[parts.month - 1] ?? ''
  }
}

/**
 * `m` as minutes rather than months, where its neighbours say so.
 *
 * Excel's own rule: a month becomes a minute when an hour comes before it or a
 * second after it, with only separators in between. It is the one piece of
 * this language that cannot be decided by looking at the token alone.
 */
function minuteTokens(tokens: readonly Token[]): Set<number> {
  const minutes = new Set<number>()

  for (const [index, token] of tokens.entries()) {
    if (token.kind !== 'date' || !/^m+$/iu.test(token.code)) continue

    const before = previousUnit(tokens, index)
    const after = nextUnit(tokens, index)
    if (before === 'h' || after === 's') minutes.add(index)
  }

  return minutes
}

const unitOf = (token: Token): string | null =>
  token.kind === 'date'
    ? (token.code[0]?.toLowerCase() ?? null)
    : token.kind === 'elapsed'
      ? (token.code[0]?.toLowerCase() ?? null)
      : null

function previousUnit(tokens: readonly Token[], index: number): string | null {
  for (let at = index - 1; at >= 0; at -= 1) {
    const unit = unitOf(tokens[at] ?? { kind: 'literal', text: '' })
    if (unit !== null) return unit
  }
  return null
}

function nextUnit(tokens: readonly Token[], index: number): string | null {
  for (let at = index + 1; at < tokens.length; at += 1) {
    const unit = unitOf(tokens[at] ?? { kind: 'literal', text: '' })
    if (unit !== null) return unit
  }
  return null
}

/** How many decimal places a `ss.00` asks of the seconds. */
function secondFraction(tokens: readonly Token[]): number {
  const at = tokens.findIndex((token) => token.kind === 'date' && /^s+$/iu.test(token.code))
  if (at === -1) return 0

  const decimal = tokens[at + 1]
  if (decimal?.kind !== 'decimal') return 0

  let places = 0
  for (let index = at + 2; index < tokens.length; index += 1) {
    if (tokens[index]?.kind !== 'digit') break
    places += 1
  }

  return places
}

function formatDate(value: number, section: Section, options: FormatOptions): string {
  const names = options.locale ?? ENGLISH
  const parts = serialToDate(value, options.date1904 ?? false)
  if (parts === null) return formatGeneral(value)

  const twelveHour = isTwelveHour(section)
  const minutes = minuteTokens(section.tokens)
  const fraction = secondFraction(section.tokens)
  const elapsed = elapsedOf(value)

  return section.tokens
    .map((token, index) => {
      switch (token.kind) {
        case 'date': {
          if (minutes.has(index)) {
            const code = token.code
            return code.length === 1 ? String(parts.minutes) : padded(parts.minutes, 2)
          }
          return dateText(token.code, parts, twelveHour, names, fraction)
        }
        case 'elapsed': {
          const unit = token.code[0]?.toLowerCase()
          const total =
            unit === 'h' ? elapsed.hours : unit === 'm' ? elapsed.minutes : elapsed.seconds
          return `${elapsed.negative ? '-' : ''}${padded(total, token.code.length)}`
        }
        case 'literal':
          return token.text
        case 'pad':
          return ' '
        case 'digit':
        case 'decimal':
          // The point and digits of a fractional second, already written with
          // the seconds themselves.
          return ''
        default:
          return ''
      }
    })
    .join('')
}

function formatNumber(value: number, section: Section, signed: boolean): string {
  const tokens = section.tokens
  const counts = digitCounts(tokens)

  const percent = tokens.filter((token) => token.kind === 'percent').length
  const scale = tokens.reduce((by, token) => (token.kind === 'scale' ? by * token.by : by), 1)
  const scaled = (value * 100 ** percent) / scale

  const exponent = tokens.find((token) => token.kind === 'exponent')
  if (exponent !== undefined) return scientific(scaled, section, counts.decimals)

  const fraction = tokens.find((token) => token.kind === 'fraction')
  if (fraction !== undefined) return fractional(scaled, section)

  // A section with no digits at all is a word standing in for a number —
  // `[>=100]"big"` — and appending the digits to it would show "big150".
  if (counts.integer === 0 && counts.decimals === 0 && !holds(section, 'decimal')) {
    return assemble(tokens, { whole: '', decimals: '', negative: false })
  }

  const { whole, fraction: places } = digitsOf(scaled, counts.decimals)
  const trimmed = places.replace(/0+$/u, '')
  const kept = places.slice(0, Math.max(counts.minimumDecimals, trimmed.length))

  const digits = counts.grouped ? groupThousands(whole) : whole
  // A number with more digits than the format has room for keeps them all:
  // `0` on 1234 is 1234, not 4.
  const body = counts.integer === 0 && whole === '0' ? '' : digits

  // The sign belongs to whoever chose the section: a negative section was
  // handed the value without one, because the section is what the sign looks
  // like — often brackets rather than a dash.
  return assemble(tokens, { whole: body, decimals: kept, negative: scaled < 0 && !signed })
}

function scientific(value: number, section: Section, decimals: number): string {
  const exponentToken = section.tokens.find((token) => token.kind === 'exponent')
  const digits = section.tokens.filter((token) => token.kind === 'digit')
  const after = digits.length - digitCounts(section.tokens).integer

  const text = Math.abs(value).toExponential(Math.max(decimals, 0))
  const [mantissa = '0', power = '+0'] = text.split('e')
  const size = Math.max(after > 0 ? after : 2, 2)
  const sign = power.startsWith('-')
    ? '-'
    : exponentToken?.kind === 'exponent' && exponentToken.sign === '+'
      ? '+'
      : ''

  return `${value < 0 ? '-' : ''}${mantissa}E${sign}${padded(Math.abs(Number(power)), size)}`
}

function fractional(value: number, section: Section): string {
  const digitsAfter = section.tokens
    .slice(section.tokens.findIndex((token) => token.kind === 'fraction'))
    .filter((token) => token.kind === 'digit')

  const fixedDigits = digitsAfter.filter((token) => token.placeholder === '0')
  const fixed = fixedDigits.length === digitsAfter.length && digitsAfter.length > 0 ? null : null

  const { whole, numerator, denominator } = fractionOf(
    value,
    Math.max(digitsAfter.length, 1),
    fixed,
  )
  const sign = value < 0 ? '-' : ''

  if (numerator === 0) return `${sign}${String(Math.abs(whole))}`
  return `${sign}${whole === 0 ? '' : `${String(Math.abs(whole))} `}${String(numerator)}/${String(denominator)}`
}

/** Puts the digits back among the literals the format states. */
function assemble(
  tokens: readonly Token[],
  digits: { whole: string; decimals: string; negative: boolean },
): string {
  let written = false
  let text = ''

  for (const token of tokens) {
    switch (token.kind) {
      case 'digit':
      case 'group':
        if (!written) {
          text += digits.whole
          written = true
        }
        break
      case 'decimal':
        if (!written) {
          text += digits.whole
          written = true
        }
        if (digits.decimals !== '') text += `.${digits.decimals}`
        break
      case 'literal':
        text += token.text
        break
      case 'pad':
        text += ' '
        break
      case 'percent':
        text += '%'
        break
      default:
        break
    }
  }

  if (!written && digits.whole !== '') text += digits.whole
  return `${digits.negative ? '-' : ''}${text}`
}

function formatText(value: string, section: Section | null): string {
  if (section === null) return value

  return section.tokens
    .map((token) =>
      token.kind === 'text'
        ? value
        : token.kind === 'literal'
          ? token.text
          : token.kind === 'pad'
            ? ' '
            : '',
    )
    .join('')
}

/**
 * A value as its format shows it.
 *
 * The one call the rest of the app makes. A format that cannot be read at all
 * shows the value as `General` does, because a cell showing its number is a
 * smaller failure than a cell showing an error.
 */
export function formatValue(
  value: number | string | null,
  code: string | null,
  options: FormatOptions = {},
): Formatted {
  if (value === null) return { text: '', color: null, fill: null }

  const format = parseFormat(code ?? 'General')
  const chosen = sectionFor(format, value)
  const section = chosen?.section ?? null
  const fill = section?.tokens.find((token) => token.kind === 'fill')?.char ?? null

  if (typeof value === 'string') {
    return { text: formatText(value, section), color: section?.color ?? null, fill }
  }

  if (section === null || (code ?? 'General').toLowerCase() === 'general') {
    return { text: formatGeneral(value), color: null, fill }
  }

  const text =
    section.kind === 'date'
      ? formatDate(value, section, options)
      : section.kind === 'text'
        ? formatText(formatGeneral(value), section)
        : formatNumber(
            Math.abs(value) === value || !(chosen?.signed ?? false) ? value : Math.abs(value),
            section,
            chosen?.signed ?? false,
          )

  return { text, color: section.color, fill }
}
