import { cellAt } from './cells'
import type { Cell, SheetCells } from './cells'
import type { CellPosition, CellRange } from './reference'

/**
 * Cells on their way to and from the clipboard.
 *
 * Three readers have to be served at once and they want different things. This
 * app wants everything — the type, the style, the formula — so that copying a
 * column and pasting it back leaves no trace. A browser or a word processor
 * wants an HTML table. Everything else on a computer wants tab-separated text.
 * So all three go on the clipboard together and the richest one that survives
 * is the one that is read.
 *
 * The fidelity rides in an attribute rather than in the markup. Encoding a
 * cell's model as HTML and reading it back would mean inventing a second file
 * format and keeping it in step with the first; a payload the table carries is
 * the model itself, and the table beside it is what everybody else sees.
 */

/** A rectangle lifted out of a sheet, with the nulls where it was empty. */
export interface CellBlock {
  rows: number
  columns: number
  /** Row-major; a null is a cell that was not there, not one that was blank. */
  cells: (Cell | null)[][]
  /** Where it was taken from, which is what a formula is shifted against. */
  origin: CellPosition
  /**
   * Which window it was copied from.
   *
   * A style is an index into the workbook it came from, and the same index in
   * another workbook is another style. Rather than paste a look nobody chose,
   * a block from elsewhere arrives without its styles — see `sameSession`.
   */
  session: string
}

/**
 * This window, for as long as it is open.
 *
 * Not a workbook: two workbooks open in one window share nothing either, and
 * the question being asked is "were these cells indexed against the styles I
 * am about to paste them into", to which only identity can answer yes.
 */
const SESSION = `${String(Date.now())}-${Math.random().toString(36).slice(2)}`

export const thisSession = (): string => SESSION

export const sameSession = (block: CellBlock): boolean => block.session === SESSION

/** The cells of a range, as a block that can be put on the clipboard. */
export function blockOf(sheet: SheetCells, range: CellRange): CellBlock {
  const top = Math.min(range.from.row, range.to.row)
  const left = Math.min(range.from.column, range.to.column)
  const bottom = Math.max(range.from.row, range.to.row)
  const right = Math.max(range.from.column, range.to.column)

  const cells = Array.from({ length: bottom - top + 1 }, (_, row) =>
    Array.from({ length: right - left + 1 }, (_, column) =>
      cellAt(sheet, { row: top + row, column: left + column }),
    ),
  )

  return {
    rows: bottom - top + 1,
    columns: right - left + 1,
    cells,
    origin: { row: top, column: left },
    session: SESSION,
  }
}

const TAB = /\t/gu
const BREAK = /\r?\n/gu

/**
 * The block as tab-separated text, which is what the rest of a computer reads.
 *
 * The shown value rather than the stored one: a date pasted into a text editor
 * should be the date somebody was looking at, not the five-figure number a
 * workbook keeps it as. Tabs and newlines inside a value are replaced by
 * spaces — the format has no way to escape them, and a value that broke the
 * grid apart would be worse than one missing a tab.
 */
export function blockToText(block: CellBlock, shown: (cell: Cell | null) => string): string {
  return block.cells
    .map((row) => row.map((cell) => shown(cell).replace(TAB, ' ').replace(BREAK, ' ')).join('\t'))
    .join('\n')
}

const escaped = (text: string): string =>
  text.replace(
    /[&<>"]/gu,
    (one) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[one] ?? ''};`,
  )

/** Base64 of any text, including the letters outside Latin-1. */
function encodePayload(text: string): string {
  const bytes = new TextEncoder().encode(text)
  const chunks: string[] = []
  for (let at = 0; at < bytes.length; at += 8192) {
    chunks.push(String.fromCharCode(...bytes.subarray(at, at + 8192)))
  }

  return btoa(chunks.join(''))
}

function decodePayload(text: string): string | null {
  try {
    const binary = atob(text)
    const bytes = new Uint8Array(binary.length)
    for (let at = 0; at < binary.length; at += 1) bytes[at] = binary.charCodeAt(at)

    return new TextDecoder().decode(bytes)
  } catch {
    // Something that was not ours, or was ours and has been mangled by an app
    // the clipboard passed through. Either way there is nothing to read.
    return null
  }
}

const PAYLOAD = 'data-orangery-cells'

/**
 * The block as an HTML table, with the model itself along for the ride.
 *
 * The table is what a browser, a word processor or a mail client will show.
 * The attribute is what this app reads back, and it holds the cells as they
 * are rather than as they look — which is why pasting a column of formulas
 * back into the same sheet restores formulas and not their answers.
 */
export function blockToHtml(block: CellBlock, shown: (cell: Cell | null) => string): string {
  const rows = block.cells
    .map((row) => `<tr>${row.map((cell) => `<td>${escaped(shown(cell))}</td>`).join('')}</tr>`)
    .join('')

  return `<table ${PAYLOAD}="${encodePayload(JSON.stringify(block))}"><tbody>${rows}</tbody></table>`
}

/**
 * The block an HTML clipboard is carrying, or null when it is not ours.
 *
 * Read from the attribute and never from the table: a table that lost the
 * attribute is a table from somewhere else, and reading its markup as if it
 * were ours would be reading a guess.
 */
export function blockFromHtml(html: string): CellBlock | null {
  const found = new RegExp(`${PAYLOAD}="([^"]*)"`, 'u').exec(html)
  const payload = found?.[1]
  if (payload === undefined) return null

  const text = decodePayload(payload)
  if (text === null) return null

  try {
    const parsed: unknown = JSON.parse(text)
    return isBlock(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isBlock(value: unknown): value is CellBlock {
  if (typeof value !== 'object' || value === null) return false

  const block = value as Partial<CellBlock>
  return (
    typeof block.rows === 'number' &&
    typeof block.columns === 'number' &&
    Array.isArray(block.cells) &&
    typeof block.session === 'string' &&
    typeof block.origin === 'object'
  )
}

/**
 * Tab-separated text as a block of plain values.
 *
 * Everything arrives as text, because text is all there is: what a `15%` from
 * somewhere else should become is the same question as what a `15%` somebody
 * types should become, and it is answered in the same place rather than twice.
 */
export function blockFromText(text: string, into: CellPosition): CellBlock {
  // A trailing newline is how most programs end a table, and taking it as an
  // empty row would paste a blank line under everything.
  const lines = text.replace(/\r\n/gu, '\n').replace(/\n$/u, '').split('\n')
  const columns = Math.max(...lines.map((line) => line.split('\t').length), 1)

  const cells = lines.map((line, row) => {
    const parts = line.split('\t')

    return Array.from({ length: columns }, (_, column): Cell | null => {
      const value = parts[column]
      if (value === undefined || value === '') return null

      return {
        row: into.row + row,
        column: into.column + column,
        type: 'inlineStr',
        value,
        style: null,
        formula: null,
        rich: null,
        carried: null,
      }
    })
  })

  return {
    rows: lines.length,
    columns,
    cells,
    origin: into,
    // Text from outside never carries styles, so it can claim this window
    // without claiming anything about a workbook.
    session: SESSION,
  }
}
