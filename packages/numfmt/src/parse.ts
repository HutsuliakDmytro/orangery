/**
 * A format code, taken apart.
 *
 * `#,##0.00;[Red](#,##0.00);"—";@` is four formats in one string: what a
 * positive number looks like, a negative, a zero, and text. Excel's little
 * language has been added to for thirty years and reads like it — the same
 * letter means different things in different places, and the only way to know
 * which is to look at what is around it.
 *
 * Two of those ambiguities matter enough to name:
 *
 * - **`m` is a month or a minute.** After an hour or before a second it is
 *   minutes; everywhere else it is months. `h:m:s` is a clock and `m/d/yyyy`
 *   is a date, and the letters are the same.
 * - **`/` is a fraction or a date separator.** In `# ?/?` it divides; in
 *   `d/m/yyyy` it is a stroke between numbers.
 *
 * Both are decided by what kind of section it is, which is decided first.
 */

export type Token =
  | { kind: 'digit'; placeholder: '0' | '#' | '?' }
  | { kind: 'decimal' }
  /** A comma between digits, which groups thousands. */
  | { kind: 'group' }
  /** A comma after the digits, which divides by a thousand for each one. */
  | { kind: 'scale'; by: number }
  | { kind: 'percent' }
  | { kind: 'literal'; text: string }
  /** `*x` — repeat the character until the cell is full, which only a grid knows. */
  | { kind: 'fill'; char: string }
  /** `_x` — a space as wide as the character, for lining columns up. */
  | { kind: 'pad'; char: string }
  /** `@` — where the text goes in a text section. */
  | { kind: 'text' }
  /** `E+` or `e-`: the letter is kept because Excel echoes the case it was given. */
  | { kind: 'exponent'; sign: '+' | '-'; letter: 'e' | 'E' }
  | { kind: 'fraction' }
  | { kind: 'date'; code: string }
  /** `[h]`, `[mm]`, `[ss]` — a unit that counts past its own wrap. */
  | { kind: 'elapsed'; code: string }

export interface Condition {
  operator: '<' | '<=' | '>' | '>=' | '=' | '<>'
  value: number
}

export interface Section {
  tokens: Token[]
  /** `[Red]` and the rest, as written; the caller decides what red is. */
  color: string | null
  /** `[>=100]` — which numbers this section is for. */
  condition: Condition | null
  kind: 'number' | 'date' | 'text'
}

export interface NumberFormat {
  sections: Section[]
  /** The code it was read from, for a writer that keeps what it was given. */
  code: string
}

const COLORS = new Set(['black', 'blue', 'cyan', 'green', 'magenta', 'red', 'white', 'yellow'])

/** Splits on the semicolons that separate sections, ignoring the quoted ones. */
function sectionsOf(code: string): string[] {
  const parts: string[] = []
  let current = ''
  let quoted = false
  let bracketed = false

  for (let at = 0; at < code.length; at += 1) {
    const char = code[at] ?? ''

    if (char === '\\' && !quoted) {
      current += char + (code[at + 1] ?? '')
      at += 1
      continue
    }
    if (char === '"') quoted = !quoted
    if (!quoted && char === '[') bracketed = true
    if (!quoted && char === ']') bracketed = false

    if (char === ';' && !quoted && !bracketed) {
      parts.push(current)
      current = ''
      continue
    }

    current += char
  }

  parts.push(current)
  return parts
}

const DATE_LETTERS = /[ymdhs]/iu

/**
 * Whether a section formats a date.
 *
 * Decided before anything else is read, because it is what makes `m` a month
 * and `/` a stroke. Letters inside quotes or brackets do not count: `0 "months"`
 * is a number, however much it talks about time.
 */
function looksLikeDate(body: string): boolean {
  const bare = body
    .replace(/"[^"]*"/gu, '')
    .replace(/\\./gu, '')
    .replace(/\[(?!h+\]|m+\]|s+\])[^\]]*\]/giu, '')

  return DATE_LETTERS.test(bare) || /\[(?:h+|m+|s+)\]/iu.test(bare)
}

/**
 * A replacement that leaves quoted runs alone.
 *
 * Everything in this language can appear inside quotes and mean itself, so a
 * scan that ignores them reads `"[" @ "]"` as a bracketed annotation and
 * deletes the text format.
 */
function replaceOutsideQuotes(
  body: string,
  pattern: RegExp,
  replace: (whole: string, inside: string) => string,
): string {
  const parts = body.split(/("[^"]*")/u)

  return parts
    .map((part) =>
      part.startsWith('"')
        ? part
        : part.replace(pattern, (whole, inside: string) => replace(whole, inside)),
    )
    .join('')
}

/** The condition, colour and currency a section states in brackets. */
function readBrackets(body: string): {
  rest: string
  color: string | null
  condition: Condition | null
  currency: string | null
} {
  let color: string | null = null
  let condition: Condition | null = null
  let currency: string | null = null

  // Quoted runs are stepped over: `"[" @ "]"` is a text format with square
  // brackets in it, not a colour and a condition.
  const rest = replaceOutsideQuotes(body, /\[([^\]]*)\]/gu, (whole, inside) => {
    const lower = inside.toLowerCase()

    // An elapsed unit is a token rather than an annotation, so it stays.
    if (/^[hms]+$/iu.test(inside)) return whole

    if (COLORS.has(lower) || /^color\s*\d+$/u.test(lower)) {
      color = inside
      return ''
    }

    const test = /^([<>=]=?|<>)\s*(-?[\d.]+)$/u.exec(inside)
    if (test !== null) {
      const operator = test[1] as Condition['operator']
      condition = { operator, value: Number(test[2]) }
      return ''
    }

    // `[$€-407]` states a currency and a locale; `[$-409]` states only the
    // locale, which decides month names in Excel and is ignored here. The
    // difference is whether there is a symbol before the dash.
    const money = /^\$([^-]*)(?:-.*)?$/u.exec(inside)
    if (money !== null) {
      const symbol = money[1] ?? ''
      currency = symbol === '' ? null : symbol
      return ''
    }

    // Anything else in brackets — a locale on its own, a calendar — says
    // nothing this can act on and nothing worth showing.
    return ''
  })

  return { rest, color, condition, currency }
}

/** Runs of the same date letter are one token: `yyyy` is a year, not four. */
function dateRun(body: string, at: number): string {
  const letter = body[at] ?? ''
  let end = at

  while ((body[end + 1] ?? '').toLowerCase() === letter.toLowerCase()) end += 1
  return body.slice(at, end + 1)
}

function tokenise(body: string, kind: Section['kind'], currency: string | null): Token[] {
  const tokens: Token[] = []
  const push = (token: Token) => tokens.push(token)

  for (let at = 0; at < body.length; at += 1) {
    const char = body[at] ?? ''

    if (char === '"') {
      const end = body.indexOf('"', at + 1)
      push({ kind: 'literal', text: body.slice(at + 1, end === -1 ? body.length : end) })
      at = end === -1 ? body.length : end
      continue
    }

    if (char === '\\') {
      push({ kind: 'literal', text: body[at + 1] ?? '' })
      at += 1
      continue
    }

    if (char === '_') {
      push({ kind: 'pad', char: body[at + 1] ?? ' ' })
      at += 1
      continue
    }

    if (char === '*') {
      push({ kind: 'fill', char: body[at + 1] ?? ' ' })
      at += 1
      continue
    }

    if (char === '[') {
      const end = body.indexOf(']', at)
      const inside = body.slice(at + 1, end === -1 ? body.length : end)
      if (/^[hms]+$/iu.test(inside)) push({ kind: 'elapsed', code: inside })
      at = end === -1 ? body.length : end
      continue
    }

    if (char === '0' || char === '#' || char === '?') {
      push({ kind: 'digit', placeholder: char })
      continue
    }

    if (char === '.') {
      // A date's dot separates — `dd.mm.yy` — unless it is the point before a
      // fraction of a second, which is decided by what follows it.
      const fractionOfSecond = kind === 'date' && /^\.0+/u.test(body.slice(at))
      push(
        kind === 'date' && !fractionOfSecond ? { kind: 'literal', text: '.' } : { kind: 'decimal' },
      )
      continue
    }

    if (char === '%') {
      push({ kind: 'percent' })
      continue
    }

    if (char === '@') {
      push({ kind: 'text' })
      continue
    }

    if ((char === 'E' || char === 'e') && (body[at + 1] === '+' || body[at + 1] === '-')) {
      push({ kind: 'exponent', sign: body[at + 1] === '+' ? '+' : '-', letter: char })
      at += 1
      continue
    }

    if (char === ',') {
      // In a date a comma is punctuation — `mmm d, yyyy`. In a number it is
      // either grouping or scaling, and which one depends on what follows, so
      // the scaling ones are folded together afterwards.
      push(kind === 'date' ? { kind: 'literal', text: ',' } : { kind: 'group' })
      continue
    }

    if (char === '/' && kind === 'number') {
      push({ kind: 'fraction' })
      continue
    }

    if (kind === 'date' && DATE_LETTERS.test(char)) {
      const run = dateRun(body, at)
      push({ kind: 'date', code: run })
      at += run.length - 1
      continue
    }

    if (kind === 'date' && /^(?:AM\/PM|A\/P)/iu.test(body.slice(at))) {
      const run = body.slice(at).toUpperCase().startsWith('AM/PM')
        ? body.slice(at, at + 5)
        : body.slice(at, at + 3)
      push({ kind: 'date', code: run })
      at += run.length - 1
      continue
    }

    push({ kind: 'literal', text: char })
  }

  if (currency !== null) tokens.unshift({ kind: 'literal', text: currency })
  return foldScaling(tokens)
}

/**
 * Commas that come after every digit, turned into division.
 *
 * `#,##0,` shows thousands and `#,##0,,` shows millions. The trailing ones are
 * the scaling; the ones between digits are grouping, and telling them apart is
 * a matter of what comes after.
 */
function foldScaling(tokens: readonly Token[]): Token[] {
  const folded: Token[] = []

  for (const [index, token] of tokens.entries()) {
    if (token.kind !== 'group') {
      folded.push(token)
      continue
    }

    const later = tokens.slice(index + 1)
    const trailing = !later.some((one) => one.kind === 'digit' || one.kind === 'decimal')

    if (!trailing) {
      folded.push(token)
      continue
    }

    const last = folded[folded.length - 1]
    if (last?.kind === 'scale') last.by *= 1000
    else folded.push({ kind: 'scale', by: 1000 })
  }

  return folded
}

/**
 * The AM/PM marker turns a 24-hour format into a 12-hour one.
 *
 * Stated here rather than found later because it changes what `h` means, and
 * the hour is written long before the marker is reached.
 */
export const isTwelveHour = (section: Section): boolean =>
  section.tokens.some((token) => token.kind === 'date' && /^(?:AM\/PM|A\/P)$/iu.test(token.code))

export function parseFormat(code: string): NumberFormat {
  const sections = sectionsOf(code).map((body) => {
    const { rest, color, condition, currency } = readBrackets(body)
    const kind: Section['kind'] = looksLikeDate(rest)
      ? 'date'
      : rest.includes('@')
        ? 'text'
        : 'number'

    return { tokens: tokenise(rest, kind, currency), color, condition, kind }
  })

  return { sections, code }
}
