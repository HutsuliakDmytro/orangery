/**
 * A1 references, which is how a spreadsheet names a place.
 *
 * Indexes are zero-based everywhere inside the model and one-based in the
 * file: `A1` is `{ row: 0, column: 0 }`. Mixing the two is the oldest bug in
 * this kind of code, so the conversion happens here and nowhere else.
 */

export interface CellPosition {
  row: number
  column: number
}

export interface CellRange {
  sheet: string | null
  from: CellPosition
  to: CellPosition
}

/** `A` → 0, `B` → 1, `AA` → 26. Null for anything that is not column letters. */
export function columnToIndex(letters: string): number | null {
  if (letters === '' || !/^[A-Z]+$/u.test(letters)) return null

  // Read code unit by code unit: column letters are ASCII by definition, and
  // walking the string the general-purpose way costs a segmenter for nothing.
  let total = 0
  for (let at = 0; at < letters.length; at += 1) {
    total = total * 26 + (letters.charCodeAt(at) - 64)
  }

  return total - 1
}

/** 0 → `A`, 26 → `AA`. */
export function indexToColumn(index: number): string {
  if (index < 0 || !Number.isFinite(index)) return 'A'

  // Bijective base 26: there is no zero digit, which is why the remainder is
  // taken before the division rather than after it.
  const letters: string[] = []
  for (let left = Math.floor(index) + 1; left > 0; left = Math.floor((left - 1) / 26)) {
    letters.unshift(String.fromCharCode(64 + ((left - 1) % 26) + 1))
  }

  return letters.join('')
}

const CELL = /^\$?([A-Z]+)\$?(\d+)$/u

/** `B2` or `$B$2` as a position; null for anything else. */
export function parseReference(reference: string): CellPosition | null {
  const match = CELL.exec(reference.trim().toUpperCase())
  if (match === null) return null

  const column = columnToIndex(match[1] ?? '')
  const row = Number(match[2])
  return column === null || !Number.isFinite(row) || row < 1 ? null : { row: row - 1, column }
}

/** A position as the file writes it: `B2`. */
export const formatReference = (position: CellPosition): string =>
  `${indexToColumn(position.column)}${String(position.row + 1)}`

/**
 * `Sheet1!$B$2:$B$5`, or `'Sheet one'!A1`, or a plain `A1:B3`.
 *
 * A single cell is a range of one, which is how a chart names a series title.
 */
export function parseRange(formula: string): CellRange | null {
  const trimmed = formula.trim()
  const bang = trimmed.lastIndexOf('!')
  const sheet = bang === -1 ? null : trimmed.slice(0, bang).replace(/^'/u, '').replace(/'$/u, '')
  const cells = bang === -1 ? trimmed : trimmed.slice(bang + 1)

  const [first, second] = cells.split(':')
  const from = parseReference(first ?? '')
  if (from === null) return null

  const to = second === undefined ? from : parseReference(second)
  return to === null ? null : { sheet, from, to }
}

/** Every cell of a range, row by row, as the file names them. */
export function cellsOfRange(range: CellRange): string[] {
  const top = Math.min(range.from.row, range.to.row)
  const bottom = Math.max(range.from.row, range.to.row)
  const left = Math.min(range.from.column, range.to.column)
  const right = Math.max(range.from.column, range.to.column)

  const cells: string[] = []
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      cells.push(formatReference({ row, column }))
    }
  }

  return cells
}

/** The same range with its last row moved, or null where it names one cell. */
export function extendedRange(formula: string, by: number): string | null {
  const range = parseRange(formula)
  if (range === null) return null

  const trimmed = formula.trim()
  const bang = trimmed.lastIndexOf('!')
  if (range.from.row === range.to.row && range.from.column === range.to.column) return null

  const last = range.to.row + by
  // A range that would end before it starts is a chart with no points, which
  // is not a chart anybody meant to make.
  if (last < range.from.row) return null

  const absolute = trimmed.includes('$')
  const write = (position: CellPosition) =>
    absolute
      ? `$${indexToColumn(position.column)}$${String(position.row + 1)}`
      : formatReference(position)

  const cells = `${write(range.from)}:${write({ row: last, column: range.to.column })}`
  return bang === -1 ? cells : `${trimmed.slice(0, bang + 1)}${cells}`
}
