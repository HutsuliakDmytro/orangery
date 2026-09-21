/**
 * Comma-separated values, which are rarely separated by commas.
 *
 * The format nobody specified and everybody writes. There is an RFC, and the
 * files people actually have disagree with it about the separator, the
 * encoding, the decimal point and what to do with a quote — so every one of
 * those is a question rather than an assumption, and the ones that can be
 * guessed are guessed out loud, in front of somebody who can correct them.
 *
 * The one part that is not negotiable is quoting: a field wrapped in quotes
 * may contain the separator, a newline, or a quote written twice. Getting that
 * wrong is how a column of addresses becomes a column of halves.
 */

export interface CsvOptions {
  /** What separates the fields; sniffed where the caller does not say. */
  delimiter: string
  /**
   * What separates a whole number from its fraction.
   *
   * A comma in most of Europe, which is also why those files use a semicolon
   * to separate their fields: two commas doing different jobs on one line is
   * a line nobody can read.
   */
  decimal: '.' | ','
}

/** The encodings a `.csv` on somebody's disk is actually likely to be in. */
export const ENCODINGS = ['utf-8', 'windows-1251', 'windows-1252'] as const
export type Encoding = (typeof ENCODINGS)[number]

const DELIMITERS = [',', ';', '\t', '|']

/**
 * The separator a file appears to use.
 *
 * Counted outside quotes and only over the first few lines: a file whose
 * fields hold prose will have commas inside quotes on every line, and one
 * whose first line is a title has nothing to count on it at all. The winner
 * is the candidate that divides the most lines into the same number of
 * fields, because the thing a separator does is make every row the same shape.
 */
export function sniffDelimiter(text: string): string {
  const lines = text
    .split(/\r?\n/u)
    .filter((line) => line !== '')
    .slice(0, 20)
  if (lines.length === 0) return ','

  let best = ','
  let bestScore = -1

  for (const candidate of DELIMITERS) {
    const counts = lines.map((line) => splitLine(line, candidate).length)
    const first = counts[0] ?? 1
    if (first < 2) continue

    const agreeing = counts.filter((count) => count === first).length
    const score = agreeing * 100 + first
    if (score > bestScore) {
      bestScore = score
      best = candidate
    }
  }

  return best
}

/** One line into fields, respecting quotes but not newlines inside them. */
function splitLine(line: string, delimiter: string): string[] {
  const fields: string[] = []
  let field = ''
  let quoted = false

  for (let at = 0; at < line.length; at += 1) {
    const here = line[at] ?? ''

    if (quoted) {
      if (here === '"') {
        if (line[at + 1] === '"') {
          field += '"'
          at += 1
        } else quoted = false
      } else field += here
      continue
    }

    if (here === '"') quoted = true
    else if (here === delimiter) {
      fields.push(field)
      field = ''
    } else field += here
  }

  fields.push(field)
  return fields
}

/**
 * The whole text as rows of fields.
 *
 * Walked once rather than split into lines first, because a quoted field may
 * hold a newline — which is exactly what a postal address in a spreadsheet
 * does — and a parser that split on newlines would cut such a row in half.
 */
export function parseCsv(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    endField()
    rows.push(row)
    row = []
  }

  const body = text.replace(/^\uFEFF/u, '')

  for (let at = 0; at < body.length; at += 1) {
    const here = body[at] ?? ''

    if (quoted) {
      if (here === '"') {
        if (body[at + 1] === '"') {
          field += '"'
          at += 1
        } else quoted = false
      } else field += here
      continue
    }

    if (here === '"') quoted = true
    else if (here === delimiter) endField()
    else if (here === '\n') endRow()
    else if (here === '\r') {
      // A lone carriage return is a line ending too, on files from before
      // 2001; followed by a newline it is half of one.
      if (body[at + 1] === '\n') at += 1
      endRow()
    } else field += here
  }

  // A file ending in a newline has no last row, only the end of the one before.
  if (field !== '' || row.length > 0) endRow()

  return rows
}

/** A field written so that reading it back gives the same field. */
function quoted(field: string, delimiter: string): string {
  const needs =
    field.includes(delimiter) || field.includes('"') || field.includes('\n') || field.includes('\r')

  return needs ? `"${field.replace(/"/gu, '""')}"` : field
}

/**
 * Rows as a file.
 *
 * Ended with CRLF, which is what the RFC says and what Excel writes; every
 * reader worth the name takes either, and the one that does not is on Windows.
 */
export const writeCsv = (rows: readonly (readonly string[])[], delimiter: string): string =>
  rows.map((row) => row.map((field) => quoted(field, delimiter)).join(delimiter)).join('\r\n')

/**
 * A field as it would be typed.
 *
 * The only change is the decimal point: `1.234,50` from a German export means
 * what `1,234.50` means here, and handing either to the value parser without
 * saying which is which makes one of them text and the other wrong.
 */
export function asTyped(field: string, decimal: '.' | ','): string {
  if (decimal === '.') return field

  const trimmed = field.trim()
  // Only where it is plainly a number in that style; anything else is words,
  // and words with commas in them are words.
  if (!/^[-+]?\d{1,3}(?:\.\d{3})*(?:,\d+)?$|^[-+]?\d+,\d+$/u.test(trimmed)) return field

  return trimmed.replace(/\./gu, '').replace(',', '.')
}

/** The text of a file, in whichever of the likely encodings it is asked for. */
export function decodeCsv(bytes: Uint8Array, encoding: Encoding): string {
  try {
    return new TextDecoder(encoding).decode(bytes)
  } catch {
    // A runtime without the full character tables; the one everybody has is
    // the one worth falling back to.
    return new TextDecoder().decode(bytes)
  }
}
