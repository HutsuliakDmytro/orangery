import {
  attribute,
  children,
  findChild,
  parseXml,
  readPackage,
  tagName,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'

/**
 * OpenDocument Spreadsheet, read.
 *
 * An `.ods` is a zip of flat XML, and its table model is close enough to a
 * worksheet to read straight into the same cells: a sheet is a `table:table`,
 * a row is a `table:table-row`, a cell is a `table:table-cell` with a type and
 * a value beside the text it shows.
 *
 * Two things make it unlike SpreadsheetML and both matter here. Repetition:
 * a row or a cell can say it stands for a thousand identical ones, and a
 * reader that took that literally would build a thousand cells for an empty
 * sheet — so repeats of blank cells are skipped and repeats of filled ones are
 * bounded. And references: a formula is written `of:=SUM([.A1:.A3])`, which is
 * the same formula in a different alphabet, so it is translated rather than
 * stored as it stands.
 *
 * This reads; `ods-write.ts` writes. Neither pretends to round-trip: an `.ods`
 * is a format this app converts, not one it keeps
 * (`docs/adr/0002-xlsx-roundtrip.md` is about the packages we promise to
 * preserve, and this is not one of them).
 */

export const CONTENT_PART = 'content.xml'
export const ODS_MIME_TYPE = 'application/vnd.oasis.opendocument.spreadsheet'

/** A cell as an `.ods` has it, before it is anything this app knows. */
export interface OdsCell {
  row: number
  column: number
  /** What to hand the value reader, which is what somebody would have typed. */
  typed: string
  /** The formula, in A1 rather than in ODF's own spelling. */
  formula: string | null
  /** How far it is drawn across and down, for a cell that was merged. */
  spans: { rows: number; columns: number } | null
}

export interface OdsSheet {
  name: string
  cells: OdsCell[]
}

/**
 * How far a repeat is believed.
 *
 * `table:number-columns-repeated="16384"` on an empty cell is how an `.ods`
 * says "the rest of the row is blank", and building sixteen thousand cells for
 * it would be reading the file as an instruction to waste memory. Filled cells
 * repeat for real — a column of the same number is written that way — so those
 * are kept, up to a limit no real table reaches.
 */
const MOST_REPEATS = 1000

const numberOf = (node: XmlNode, name: string, fallback: number): number => {
  const stated = Number(attribute(node, name))
  return Number.isFinite(stated) && stated > 0 ? stated : fallback
}

/** Everything written in a cell, paragraphs joined by the line breaks they are. */
function textIn(node: XmlNode): string {
  const lines = children(node)
    .filter((child) => tagName(child) === 'text:p')
    .map((paragraph) => flatten(paragraph))

  return lines.join('\n')
}

/** One paragraph, with the spans and the links inside it flattened into words. */
function flatten(node: XmlNode): string {
  const own = node['#text']
  const here = typeof own === 'string' ? own : ''

  return (
    here +
    children(node)
      .map((child) => {
        const name = tagName(child)
        if (name === 'text:s') return ' '.repeat(numberOf(child, 'text:c', 1))
        if (name === 'text:tab') return '\t'
        if (name === 'text:line-break') return '\n'
        return flatten(child)
      })
      .join('')
  )
}

/**
 * An ODF formula as this app spells one.
 *
 * `of:=SUM([.A1:.A3])` is `SUM(A1:A3)`: the namespace goes, the brackets that
 * mark a reference go, a sheet is named with `!` rather than with `$` and a
 * dot, and the argument separator is a comma. What is left is the same
 * formula — nothing here evaluates it, and the cached value comes from the
 * file.
 */
export function formulaFrom(stated: string): string | null {
  const text = stated.replace(/^[a-z]+:/iu, '')
  if (!text.startsWith('=')) return null

  return (
    text
      .slice(1)
      // `[$'Sheet name'.A1]` and `[.A1:.B2]`, which is one reference or two.
      .replace(/\[([^\]]*)\]/gu, (_, inside: string) =>
        inside
          .split(':')
          .map((part) => {
            const at = part.lastIndexOf('.')
            const sheet = at <= 0 ? '' : part.slice(0, at).replace(/^\$/u, '')
            const cell = part.slice(at + 1)
            return sheet === '' ? cell : `${sheet}!${cell}`
          })
          .join(':'),
      )
      .replace(/;/gu, ',')
  )
}

/** An ODF duration — `PT01H30M00S` — as the time somebody would have typed. */
function timeFrom(stated: string): string | null {
  const parts = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?$/u.exec(stated)
  if (parts === null) return null

  const two = (value: string | undefined) => (value ?? '0').padStart(2, '0')
  return `${two(parts[1])}:${two(parts[2])}:${two(parts[3]?.split('.')[0])}`
}

/**
 * What a cell would have been typed as.
 *
 * Every value goes back through the same reader typing does, which is how a
 * date becomes a date here as well — but the type is taken from the file
 * rather than guessed, so a string that looks like a number stays a string.
 * That is what the apostrophe is for.
 */
function typedValue(cell: XmlNode): string {
  const kind = attribute(cell, 'office:value-type') ?? ''
  const value = attribute(cell, 'office:value')

  if (kind === 'float' || kind === 'currency') return value ?? textIn(cell)
  if (kind === 'percentage')
    return value === undefined ? textIn(cell) : `${String(Number(value) * 100)}%`
  if (kind === 'boolean')
    return attribute(cell, 'office:boolean-value') === 'true' ? 'TRUE' : 'FALSE'

  if (kind === 'date') {
    const stated = attribute(cell, 'office:date-value') ?? ''
    // A date with a time in it keeps both; the reader takes either.
    return stated.replace('T', ' ')
  }

  if (kind === 'time') {
    const stated = attribute(cell, 'office:time-value') ?? ''
    return timeFrom(stated) ?? textIn(cell)
  }

  // Everything else is what it shows, said to be text: a part number that
  // looks like a date is a part number, and the file said so.
  const shown = textIn(cell)
  return shown === '' ? '' : `'${shown}`
}

/** The sheets of an `.ods`, as cells anybody can put into a workbook. */
export function readOdsContent(xml: string): OdsSheet[] {
  const root = parseXml(xml).find((node) => tagName(node) === 'office:document-content')
  const body = root === undefined ? undefined : findChild(root, 'office:body')
  const spreadsheet = body === undefined ? undefined : findChild(body, 'office:spreadsheet')
  if (spreadsheet === undefined) return []

  return children(spreadsheet).flatMap((table): OdsSheet[] => {
    if (tagName(table) !== 'table:table') return []

    return [
      {
        name: attribute(table, 'table:name') ?? 'Sheet',
        cells: cellsOf(table),
      },
    ]
  })
}

function cellsOf(table: XmlNode): OdsCell[] {
  const cells: OdsCell[] = []
  let row = 0

  for (const node of children(table)) {
    const name = tagName(node)
    // Rows inside a group are rows; the grouping itself is not read.
    const rows = name === 'table:table-row-group' ? children(node) : [node]

    for (const line of rows) {
      if (tagName(line) !== 'table:table-row') continue

      const repeated = numberOf(line, 'table:number-rows-repeated', 1)
      const found = rowCells(line, row)

      if (found.length === 0) {
        // An empty row that stands for a thousand is a thousand empty rows,
        // and they are all nothing.
        row += repeated
        continue
      }

      for (let again = 0; again < Math.min(repeated, MOST_REPEATS); again += 1) {
        cells.push(...found.map((cell) => ({ ...cell, row: row + again })))
      }

      row += repeated
    }
  }

  return cells
}

function rowCells(line: XmlNode, row: number): OdsCell[] {
  const cells: OdsCell[] = []
  let column = 0

  for (const node of children(line)) {
    const name = tagName(node)
    if (name !== 'table:table-cell' && name !== 'table:covered-table-cell') continue

    const repeated = numberOf(node, 'table:number-columns-repeated', 1)

    // A covered cell is one a merge is drawn over; it holds nothing and is
    // skipped, since the merge itself is on the cell that covers it.
    if (name === 'table:covered-table-cell') {
      column += repeated
      continue
    }

    const typed = typedValue(node)
    const stated = attribute(node, 'table:formula')
    const formula = stated === undefined ? null : formulaFrom(stated)

    const across = numberOf(node, 'table:number-columns-spanned', 1)
    const down = numberOf(node, 'table:number-rows-spanned', 1)

    if (typed !== '' || formula !== null) {
      for (let again = 0; again < Math.min(repeated, MOST_REPEATS); again += 1) {
        cells.push({
          row,
          column: column + again,
          typed,
          formula,
          spans: across > 1 || down > 1 ? { rows: down, columns: across } : null,
        })
      }
    }

    column += repeated
  }

  return cells
}

/** The sheets of a file, read out of the package it arrives as. */
export async function readOds(bytes: Uint8Array): Promise<OdsSheet[]> {
  const pkg: OoxmlPackage = await readPackage(bytes, CONTENT_PART)
  const content = pkg.parts.get(CONTENT_PART)

  const xml =
    content?.text ?? (content === undefined ? '' : new TextDecoder().decode(content.bytes))

  return readOdsContent(xml)
}
