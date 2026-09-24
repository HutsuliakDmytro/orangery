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
  /** How many of the integer places must show a digit even when there is none. */
  minimumInteger: number
  /** How many must show a space instead, to line the column up. */
  paddedInteger: number
  decimals: number
  minimumDecimals: number
  grouped: boolean
} {
  let integer = 0
  let minimumInteger = 0
  let paddedInteger = 0
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
      if (token.placeholder === '0') minimumInteger += 1
      if (token.placeholder === '?') paddedInteger += 1
    }
  }

  return { integer, minimumInteger, paddedInteger, decimals, minimumDecimals, grouped }
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
 * How wide `General` is allowed to be.
 *
 * Eleven characters, counting the decimal point and not the minus sign. It is
 * a width and not a count of significant digits, which is why 0.000000001 is
 * shown in full — one significant digit in eleven characters — while
 * 1.2345678912 loses its last digit and 1e-10 is not shown this way at all.
 */
const GENERAL_WIDTH = 11

/**
 * The plain decimal picture of a number, if it fits.
 *
 * `null` where it does not: either the digits before the point already fill
 * the width, or the number is so small that everything inside the width is a
 * zero. Both are the cases Excel answers with scientific notation instead.
 */
function fitted(magnitude: number): string | null {
  const integerWidth = Math.max(1, Math.floor(Math.log10(magnitude)) + 1)
  if (integerWidth > GENERAL_WIDTH) return null

  // What is left of the width once the integer digits and the point have had
  // their share; a number with no room for a point keeps none.
  const decimals = Math.max(0, GENERAL_WIDTH - integerWidth - 1)
  const text = magnitude.toFixed(Math.min(decimals, 100))

  // Rounding can carry: 99999999999.5 in eleven characters is a twelfth
  // digit, and Excel writes that as an exponent rather than shortening it.
  const [whole = '', fraction = ''] = text.split('.')
  if (whole.length > GENERAL_WIDTH) return null
  if (Number(text) === 0) return null

  const kept = fraction.replace(/0+$/u, '')
  return kept === '' ? whole : `${whole}.${kept}`
}

/**
 * `General` — the format a cell has when it has none.
 *
 * Excel fits the number into eleven characters and reaches for an exponent
 * only when it cannot: 0.000000001 is written out, 0.0000000001 would need a
 * twelfth character and becomes `1E-10`. The rule is about width rather than
 * about digits, which is the part that is easy to get wrong — eleven
 * significant digits would show both of those numbers the same way, and Excel
 * does not.
 *
 * Excel's real `General` also narrows itself to the column, which nothing here
 * knows about; this is the width-independent part, and the one `TEXT` uses.
 */
export function formatGeneral(value: number): string {
  if (!Number.isFinite(value)) return String(value)
  if (value === 0) return '0'

  const sign = value < 0 ? '-' : ''
  const plain = fitted(Math.abs(value))
  if (plain !== null) return `${sign}${plain}`

  // Five places of mantissa, with whatever trailing zeros that leaves taken
  // off again: 1.1e-10 is `1.1E-10` and not `1.10000E-10`.
  const [mantissa = '0', power = '0'] = Math.abs(value).toExponential(5).split('e')
  const exponent = Number(power)
  const trimmed = mantissa.includes('.') ? mantissa.replace(/\.?0+$/u, '') : mantissa

  return `${sign}${trimmed}E${exponent < 0 ? '-' : '+'}${padded(Math.abs(exponent), 2)}`
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

  // A format in scientific notation has an exponent to move the point with,
  // and Excel does not move it twice: the per-cent sign and the trailing
  // comma are drawn where they stand and multiply nothing. `#%e+#` on 123456
  // is `1%e+5`, not `1%e+7`.
  const exponent = tokens.find((token) => token.kind === 'exponent')
  if (exponent !== undefined) return scientific(value, section)

  const percent = tokens.filter((token) => token.kind === 'percent').length
  const scale = tokens.reduce((by, token) => (token.kind === 'scale' ? by * token.by : by), 1)
  const scaled = (value * 100 ** percent) / scale

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

  // `#` means a digit if there is one, `0` means one whether or not, and `?`
  // means a space where there is none. So `#.##` on a half is `.5` while
  // `0.##` is `0.5` — the difference every spreadsheet person knows by sight
  // and nobody can explain from the code alone.
  const required = whole === '0' && counts.minimumInteger === 0 ? '' : whole
  const filled = required.padStart(counts.minimumInteger, '0')
  const spaced = filled.padStart(
    Math.max(counts.minimumInteger + counts.paddedInteger, filled.length),
    ' ',
  )

  // A number with more digits than the format has room for keeps them all:
  // `0` on 1234 is 1234, not 4.
  const body = spaced === '' ? '' : counts.grouped ? groupThousands(spaced) : spaced

  // The sign belongs to whoever chose the section: a negative section was
  // handed the value without one, because the section is what the sign looks
  // like — often brackets rather than a dash.
  return assemble(tokens, { whole: body, decimals: kept, negative: scaled < 0 && !signed })
}

type Placeholder = '0' | '#' | '?'

/** The digit placeholders of a run of tokens, in the order they are written. */
const placeholdersOf = (tokens: readonly Token[]): Placeholder[] =>
  tokens.filter((token) => token.kind === 'digit').map((token) => token.placeholder)

/**
 * Digits laid into placeholders that there are too many of.
 *
 * The digits are right-aligned and the places left over on the left are what
 * the placeholder says an absent digit looks like: `0` writes a zero, `?`
 * writes a space to line the column up, and `#` writes nothing at all. A
 * thousands separator that falls in the empty part goes the same way as the
 * digit beside it — `?,??????` on six digits is two spaces and then the
 * number, not a space and a stranded comma.
 */
function laidOut(digits: string, places: readonly Placeholder[], grouped: boolean): string {
  const blanks = Math.max(0, places.length - digits.length)
  const padded = digits.padStart(places.length, '0')

  /** What an empty place is written as, which is the whole of the difference. */
  const blank = (at: number, char: string): string => {
    const place = places[at] ?? '#'
    return place === '0' ? char : place === '?' ? ' ' : ''
  }

  let text = ''

  for (let at = 0; at < padded.length; at += 1) {
    // A separator stands before every third digit counted from the right, and
    // goes the way the place to its left went: kept beside a zero, a space
    // beside a `?`, gone beside a `#`.
    if (grouped && at > 0 && (padded.length - at) % 3 === 0) {
      text += at - 1 < blanks ? blank(at - 1, ',') : ','
    }

    const char = padded[at] ?? '0'
    text += at < blanks ? blank(at, char) : char
  }

  return text
}

/**
 * The places after the point, cut where the format stops asking for them.
 *
 * A `0` holds its place whatever the digit is; past the last of them a `#`
 * drops a trailing zero and a `?` turns it into a space.
 */
function decimalsLaidOut(digits: string, places: readonly Placeholder[]): string {
  const significant = digits.replace(/0+$/u, '').length
  const required = places.map((place) => place === '0').lastIndexOf(true) + 1
  const kept = Math.max(significant, required)

  return places
    .map((place, index) =>
      index < kept ? (digits[index] ?? '0') : place === '?' ? ' ' : place === '0' ? '0' : '',
    )
    .join('')
}

/**
 * The power of ten a mantissa is written against.
 *
 * Not always the one that leaves a single digit before the point. The
 * exponent steps by however many integer placeholders the format has, so
 * `##0.0E+0` counts in thousands the way an engineer writes them and
 * `####.####e+#` counts in ten-thousands. One placeholder gives the ordinary
 * kind, which is why the rule is invisible until somebody writes two.
 *
 * Read off `toExponential` rather than `log10`, which answers 2.9999999999999996
 * for a thousand and would put the point in the wrong place once in a while.
 */
function exponentFor(magnitude: number, step: number): number {
  if (magnitude === 0) return 0

  const power = Number(magnitude.toExponential().split('e')[1] ?? '0')
  return step * Math.floor(power / step)
}

/** A magnitude divided by a power of ten, in two steps where one would overflow. */
function shifted(magnitude: number, exponent: number): number {
  if (Math.abs(exponent) <= 300) return magnitude / 10 ** exponent

  const half = Math.trunc(exponent / 2)
  return magnitude / 10 ** half / 10 ** (exponent - half)
}

/**
 * A number in the shape `0.00E+00` asks for.
 *
 * Everything about it is counted from the format rather than from the number:
 * how many digits stand before the point, how many after, how wide the
 * exponent is, and — the part that is easy to miss — how far the exponent
 * moves at a time. Four integer placeholders mean the exponent is a multiple
 * of four, so 123456.789 through `####.####e+#` is 12.3457e+4 rather than
 * 1.2346e+5.
 *
 * Written by walking the tokens, because everything between them belongs to
 * the answer: `#%e+#` shows a per-cent sign that multiplies nothing, `#e+#,`
 * shows a comma that divides nothing, and a format that puts its own
 * punctuation around the exponent keeps it.
 */
function scientific(value: number, section: Section): string {
  const tokens = section.tokens
  const at = tokens.findIndex((token) => token.kind === 'exponent')
  const mantissaTokens = tokens.slice(0, at)
  const exponentTokens = tokens.slice(at + 1)

  const point = mantissaTokens.findIndex((token) => token.kind === 'decimal')
  const integerPlaces = placeholdersOf(
    point === -1 ? mantissaTokens : mantissaTokens.slice(0, point),
  )
  const decimalPlaces = point === -1 ? [] : placeholdersOf(mantissaTokens.slice(point + 1))
  const exponentPlaces = placeholdersOf(exponentTokens)

  const magnitude = Math.abs(value)
  const step = Math.max(integerPlaces.length, 1)
  const exponent = exponentFor(magnitude, step)
  const { whole, fraction } = digitsOf(shifted(magnitude, exponent), decimalPlaces.length)

  // Zero has no digits to lay out, and Excel fills every place it was given
  // rather than leaving them blank: `####.####e+#` shows `0000.e+0`.
  const integerText =
    magnitude === 0
      ? laidOut('0'.repeat(step), integerPlaces, holds(section, 'group'))
      : laidOut(whole, integerPlaces, holds(section, 'group'))

  const exponentToken = tokens[at]
  const letter = exponentToken?.kind === 'exponent' ? exponentToken.letter : 'E'
  const sign =
    exponent < 0 ? '-' : exponentToken?.kind === 'exponent' && exponentToken.sign === '+' ? '+' : ''

  let written = false
  let body = ''

  for (const token of mantissaTokens) {
    switch (token.kind) {
      case 'digit':
        if (!written) {
          body += integerText
          written = true
        }
        break
      case 'decimal':
        if (!written) {
          body += integerText
          written = true
        }
        // The point stands whether or not anything follows it: `#.#e+#` on
        // nothing is `0.e+0`, which looks like a typo and is not one.
        body += `.${decimalsLaidOut(fraction, decimalPlaces)}`
        break
      case 'literal':
        body += token.text
        break
      case 'pad':
        body += ' '
        break
      case 'percent':
        body += '%'
        break
      default:
        break
    }
  }

  if (!written) body += integerText

  let tail = ''
  let placed = false
  for (const token of exponentTokens) {
    switch (token.kind) {
      case 'digit':
        if (!placed) {
          // The sign belongs to the digits rather than to the letter: a
          // format that puts something of its own between the two — `e+|#|` —
          // writes it as `e|+5`.
          tail += sign + laidOut(String(Math.abs(exponent)), exponentPlaces, false)
          placed = true
        }
        break
      case 'literal':
        tail += token.text
        break
      case 'pad':
        tail += ' '
        break
      case 'percent':
        tail += '%'
        break
      default:
        break
    }
  }

  if (!placed) tail += sign + laidOut(String(Math.abs(exponent)), exponentPlaces, false)

  return `${value < 0 ? '-' : ''}${body}${letter}${tail}`
}

/**
 * Digits laid one to a place, for a format that puts something between them.
 *
 * `laidOut` answers with a string because the places it fills are next to each
 * other. A fraction's are not: `#-#-#\:#/#` has literals in among the whole
 * number's places, and each one has to be written where the format put it. So
 * this answers per place instead — the same right-aligned digits, the same
 * blanks, handed back one at a time.
 */
function placeText(digits: string, places: readonly Placeholder[]): string[] {
  const blanks = Math.max(0, places.length - digits.length)
  const spare = Math.max(0, digits.length - places.length)
  const padded = digits.padStart(places.length, '0')

  return places.map((place, at) => {
    // A number with more digits than the format has room for keeps them all,
    // and they pile up in the first place rather than being cut off.
    const char = at === 0 ? padded.slice(0, spare + 1) : (padded[at + spare] ?? '0')
    return at < blanks ? (place === '0' ? char : place === '?' ? ' ' : '') : char
  })
}

/**
 * The shape a fraction format is in.
 *
 * Three runs of places and whatever the format wove between them: the whole
 * number, the numerator, the denominator. Which is which falls out of where
 * the stroke is — the numerator is the run of places nearest it on the left,
 * the denominator the run nearest on the right, and anything further left
 * again is the whole number. `#\:#=/=#` puts an equals sign on either side of
 * the stroke, and the run is still the run.
 */
function fractionShape(tokens: readonly Token[]): {
  whole: number[]
  numerator: number[]
  denominator: number[]
  stroke: number
} {
  const stroke = tokens.findIndex((token) => token.kind === 'fraction')
  const digit = (at: number) => tokens[at]?.kind === 'digit'

  let left = stroke - 1
  while (left >= 0 && !digit(left)) left -= 1
  const numerator: number[] = []
  while (left >= 0 && digit(left)) {
    numerator.unshift(left)
    left -= 1
  }

  let right = stroke + 1
  while (right < tokens.length && !digit(right)) right += 1
  const denominator: number[] = []
  while (right < tokens.length && digit(right)) {
    denominator.push(right)
    right += 1
  }

  const whole: number[] = []
  for (let at = 0; at < (numerator[0] ?? stroke); at += 1) if (digit(at)) whole.push(at)

  return { whole, numerator, denominator, stroke }
}

/** The places of a run of token positions. */
const placesAt = (tokens: readonly Token[], where: readonly number[]): Placeholder[] =>
  where.map((at) => {
    const token = tokens[at]
    return token?.kind === 'digit' ? token.placeholder : '#'
  })

/** How wide a token is on the page, for a part that is dropped but holds its place. */
function widthOf(token: Token): number {
  switch (token.kind) {
    case 'literal':
      return token.text.length
    case 'digit':
    case 'decimal':
    case 'fraction':
    case 'percent':
    case 'pad':
      return 1
    default:
      return 0
  }
}

/**
 * A number as a fraction, the way a format asks for one.
 *
 * Three shapes, and they mean different things:
 *
 * - `# ?/?` — a whole part and a fraction beside it: 1.25 is `1 1/4`;
 * - `?/?` — no whole part, so the fraction carries all of it: 1.25 is `5/4`;
 * - `?/16` — the denominator is stated, and the numerator is whatever comes
 *   nearest: 0.3 is `5/16`.
 *
 * What makes this harder than it looks is that either half can be absent and
 * the format still has to read as a number. A whole number with nothing left
 * over drops its fraction — `# ?/?` on three is `3`, not `3 0/1` — and a value
 * under one drops its whole number. Whatever the format put *between* them
 * goes with it, which is why `#\:#/#` on three quarters is `3/4` and not
 * `:3/4`, while the dashes of `#-#-#\:#/#` stay where they are: they are
 * inside the whole number rather than between the two halves.
 *
 * Unless the format asked for `?` somewhere. `?` is a space where there is no
 * digit, and a format that asks for one is asking for a column that lines up,
 * so a part dropped out of such a format leaves its own width behind in
 * spaces. `?\:?=/=?` on one is `1` followed by six of them.
 */
function fractional(value: number, section: Section): string {
  const tokens = section.tokens
  const shape = fractionShape(tokens)

  const wholePlaces = placesAt(tokens, shape.whole)
  const numeratorPlaces = placesAt(tokens, shape.numerator)
  const denominatorPlaces = placesAt(tokens, shape.denominator)

  // A denominator written out rather than asked for: `?/16` fixes it at
  // sixteenths however badly they fit.
  const stated = tokens
    .slice(shape.stroke + 1)
    .filter((token) => token.kind === 'literal')
    .map((token) => token.text)
    .join('')
  const fixed = denominatorPlaces.length === 0 && /^\d+$/u.test(stated) ? Number(stated) : null

  const magnitude = Math.abs(value)
  const carries = wholePlaces.length > 0
  const whole = carries ? Math.trunc(magnitude) : 0
  const found = fractionOf(magnitude - whole, Math.max(denominatorPlaces.length, 1), fixed)
  const denominator = fixed ?? found.denominator
  // With no whole number to carry it, the fraction carries the lot: 3.75
  // through `#/#` is fifteen quarters.
  const numerator = carries ? found.numerator : Math.round(magnitude * denominator)

  // A `0` is a digit whether or not there is one to show, so a numerator
  // spelled with one keeps the fraction alive where a `#` would let it go.
  // The denominator has no say in it: `#\\:#=/=0` on one is `1`.
  const showsFraction = !carries || numerator !== 0 || numeratorPlaces.includes('0')

  // A whole number of nothing is not written beside a fraction — three
  // quarters is `3/4`, not `0 3/4` — but it is written when there is no
  // fraction to write instead, because something has to stand for the value.
  const wholeDigits =
    !carries || (showsFraction && magnitude !== 0 && whole === 0) ? '' : String(whole)

  // A zero with nowhere but `#` to go is the one place the placeholders differ
  // about zero: `#` shows nothing, `?` and `0` show the digit.
  const hides = showsFraction && wholeDigits === '0' && wholePlaces.every((place) => place === '#')

  // A part dropped out of a format that asked for columns holds its width in
  // spaces, so the numbers under it still line up. Which `?` counts depends
  // on which part went: what stood between the two halves lines up with the
  // halves beside it, and a fraction that is not written lines up with the
  // fraction that would have been.
  const asksColumns = (places: readonly Placeholder[]) => places.includes('?')
  const holds = {
    separator: asksColumns(wholePlaces) || asksColumns(numeratorPlaces),
    fraction:
      asksColumns(wholePlaces) || asksColumns(numeratorPlaces) || asksColumns(denominatorPlaces),
  }
  const gone = (token: Token, part: 'separator' | 'fraction') =>
    holds[part] ? ' '.repeat(widthOf(token)) : ''

  const wholeText = placeText(hides ? '' : wholeDigits, wholePlaces)
  // What stands between the two halves belongs to whichever of them wrote
  // something; a column of spaces is not something.
  const showsWhole = wholeText.join('').trim() !== ''
  const numeratorText = placeText(String(numerator), numeratorPlaces)
  const denominatorText = placeText(String(denominator), denominatorPlaces)

  // Where each half begins and ends, so the punctuation around them can be
  // told from the punctuation between them.
  const opens = shape.numerator[0] ?? shape.stroke
  const closes = shape.denominator[shape.denominator.length - 1] ?? shape.stroke
  const wholeEnds = shape.whole[shape.whole.length - 1] ?? -1

  let text = ''

  for (const [at, token] of tokens.entries()) {
    const between = carries && at > wholeEnds && at < opens
    const inFraction = at >= opens && at <= closes
    const dropped = !showsFraction
      ? between || inFraction
        ? 'fraction'
        : null
      : between && !showsWhole
        ? 'separator'
        : null

    if (dropped !== null) {
      text += gone(token, dropped)
      continue
    }

    switch (token.kind) {
      case 'digit': {
        const whereWhole = shape.whole.indexOf(at)
        const whereNumerator = shape.numerator.indexOf(at)
        const whereDenominator = shape.denominator.indexOf(at)
        text +=
          whereWhole !== -1
            ? (wholeText[whereWhole] ?? '')
            : whereNumerator !== -1
              ? (numeratorText[whereNumerator] ?? '')
              : (denominatorText[whereDenominator] ?? '')
        break
      }
      case 'fraction':
        text += '/'
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

  return `${value < 0 ? '-' : ''}${text}`
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
