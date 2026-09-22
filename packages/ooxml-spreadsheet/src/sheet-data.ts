import { parseXml, tagName } from '@orangery/ooxml-core'
import { columnToIndex, formatReference } from './reference'
import { emptySheet, putCell } from './cells'
import type { Cell, CellType, Formula, RowProperties, SheetCells } from './cells'
import { collapsedFormula, expandFormulas, sharedMasters } from './formulas'
import type { SharedMaster } from './formulas'
import { readRichText } from './rich-text'
import type { RichText } from './rich-text'
import { elementPattern } from './patterns'

/**
 * `sheetData`, read without building a tree.
 *
 * The one part of a workbook that is not like the others: a worksheet with
 * half a million rows is thirty million nodes, and a DOM of it is a browser
 * tab that stops responding. So this is a scanner — it walks the text once,
 * hands out cells as it finds them, and keeps nothing but the model.
 *
 * It reads what the format actually contains rather than what the schema
 * allows: `<row>` and `<c>` with their attributes, `<v>`, `<f>` and `<is>`.
 * Anything else inside a cell is carried by the cell that held it, because the
 * alternative is losing it (`apps/sheets/docs/adr/0002-xlsx-roundtrip.md`).
 */

/** The attributes a cell states that this models; the rest are carried. */
const MODELLED_CELL = new Set(['r', 's', 't'])

/** The same for `<f>`: `ca`, `bx` and the data-table attributes are carried. */
const MODELLED_FORMULA = new Set(['t', 'si', 'ref'])
const MODELLED_ROW = new Set([
  'r',
  'ht',
  'customHeight',
  'hidden',
  'outlineLevel',
  's',
  'customFormat',
  'collapsed',
])

const TYPES = new Set<CellType>(['n', 's', 'str', 'b', 'e', 'inlineStr', 'd'])

const ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
}

/** Text as the file wrote it, with the five entities XML insists on read back. */
export function decodeText(text: string): string {
  if (!text.includes('&')) return text

  return text.replace(/&(#x?[0-9a-fA-F]+|[a-z]+);/gu, (whole, name: string) => {
    if (name.startsWith('#x') || name.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(name.slice(2), 16))
    }
    if (name.startsWith('#')) return String.fromCodePoint(Number(name.slice(1)))
    return ENTITIES[name] ?? whole
  })
}

const ATTRIBUTE = /([:\w-]+)\s*=\s*"([^"]*)"/gu

/** The attributes of an opening tag, as written. */
function attributesOf(tag: string): Record<string, string> {
  const found: Record<string, string> = {}

  ATTRIBUTE.lastIndex = 0
  for (let match = ATTRIBUTE.exec(tag); match !== null; match = ATTRIBUTE.exec(tag)) {
    const name = match[1]
    if (name !== undefined) found[name] = decodeText(match[2] ?? '')
  }

  return found
}

/** What a tag leaves over once the modelled attributes are taken out of it. */
function carriedFrom(
  attributes: Record<string, string>,
  modelled: ReadonlySet<string>,
): Record<string, string> | null {
  const rest = Object.entries(attributes).filter(([name]) => !modelled.has(name))
  return rest.length === 0 ? null : Object.fromEntries(rest)
}

const numberOr = (text: string | undefined, fallback: number | null): number | null => {
  if (text === undefined) return fallback
  const parsed = Number(text)
  return Number.isFinite(parsed) ? parsed : fallback
}

const flag = (text: string | undefined): boolean => text === '1' || text === 'true'

/**
 * The text of an element inside a fragment, without parsing the fragment.
 *
 * `<is>` holds runs, and a cell's words are all of their `<t>` joined: a
 * string split across three runs because somebody made one word bold is still
 * one string in the cell.
 */
function textOfAll(fragment: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?(?:/>|>([\\s\\S]*?)</${tag}>)`, 'gu')
  let found: string | null = null

  for (let match = pattern.exec(fragment); match !== null; match = pattern.exec(fragment)) {
    found = (found ?? '') + decodeText(match[1] ?? '')
  }

  return found
}

/**
 * The runs of an inline string, where it has any.
 *
 * Only when there is an `<r>` in the cell: parsing every `<is>` would be a
 * tree per text cell in a file of a million of them, for an answer that is
 * "one plain run" every time. The markup is kept beside the runs so the cell
 * is written back exactly as it arrived.
 */
function richFrom(fragment: string): RichText | null {
  if (!fragment.includes('<r')) return null

  const match = elementPattern('is').exec(fragment)
  const inside = match?.[2]
  if (inside === undefined || !/<r(?:\s|>)/u.test(inside)) return null

  const root = parseXml(`<is>${inside}</is>`).find((node) => tagName(node) === 'is')
  return root === undefined ? null : readRichText(root, inside)
}

function formulaFrom(fragment: string): Formula | null {
  const match = elementPattern('f').exec(fragment)
  if (match === null) return null

  const attributes = attributesOf(match[1] ?? '')
  const stated = attributes['t']
  const kind: Formula['kind'] =
    stated === 'shared' || stated === 'array' || stated === 'dataTable' ? stated : 'normal'

  return {
    text: decodeText(match[2] ?? ''),
    kind,
    shared: numberOr(attributes['si'], null),
    ref: attributes['ref'] ?? null,
    carried: carriedFrom(attributes, MODELLED_FORMULA),
  }
}

export interface SheetDataHandlers {
  onRow?: (row: RowProperties) => void
  onCell?: (cell: Cell) => void
}

/**
 * Walks `sheetData` once, announcing the rows and cells it passes.
 *
 * The position of a cell comes from its `r` attribute where it has one, and
 * from counting otherwise: a writer may leave `r` off, and then a cell's place
 * is where it falls. Rows are the same.
 */
export function scanSheetData(xml: string, handlers: SheetDataHandlers): void {
  const body = /<sheetData(?:\s[^>]*)?>([\s\S]*)<\/sheetData>/u.exec(xml)
  if (body === null) return

  const rows = elementPattern('row', 'gu')
  const cells = elementPattern('c', 'gu')
  const text = body[1] ?? ''

  let rowIndex = 0
  for (let row = rows.exec(text); row !== null; row = rows.exec(text)) {
    const attributes = attributesOf(row[1] ?? '')
    const stated = numberOr(attributes['r'], null)
    rowIndex = stated === null ? rowIndex + 1 : stated

    handlers.onRow?.({
      index: rowIndex - 1,
      height: numberOr(attributes['ht'], null),
      customHeight: flag(attributes['customHeight']),
      hidden: flag(attributes['hidden']),
      outlineLevel: numberOr(attributes['outlineLevel'], null),
      style: flag(attributes['customFormat']) ? numberOr(attributes['s'], null) : null,
      collapsed: flag(attributes['collapsed']),
      carried: carriedFrom(attributes, MODELLED_ROW),
    })

    if (handlers.onCell === undefined) continue

    let column = 0
    const inside = row[2] ?? ''
    cells.lastIndex = 0

    for (let cell = cells.exec(inside); cell !== null; cell = cells.exec(inside)) {
      const own = attributesOf(cell[1] ?? '')
      const reference = own['r']
      const at = reference === undefined ? null : columnToIndex(reference.replace(/\d+$/u, ''))
      column = at === null ? column + 1 : at + 1

      const fragment = cell[2] ?? ''
      const stated = own['t']
      const type: CellType =
        stated !== undefined && TYPES.has(stated as CellType) ? (stated as CellType) : 'n'

      handlers.onCell({
        row: rowIndex - 1,
        column: column - 1,
        type,
        // An inline string keeps its words in the cell; everything else keeps
        // a value, which for a shared string is an index into the table.
        value: type === 'inlineStr' ? textOfAll(fragment, 't') : textOfAll(fragment, 'v'),
        style: numberOr(own['s'], null),
        formula: formulaFrom(fragment),
        rich: type === 'inlineStr' ? richFrom(fragment) : null,
        carried: carriedFrom(own, MODELLED_CELL),
      })
    }
  }
}

/**
 * The whole of `sheetData` as the sparse model.
 *
 * With the shared and array formulas expanded, so that a cell can be asked
 * what it computes without anybody above here knowing that the answer may be
 * written on a different cell (`formulas.ts`).
 */
export function readSheetData(xml: string): SheetCells {
  const sheet = emptySheet()

  scanSheetData(xml, {
    onRow: (row) => {
      // Rows exist for their properties as well as their cells: a row with a
      // height and nothing in it is a row somebody made taller.
      sheet.properties.set(row.index, row)
    },
    onCell: (cell) => {
      putCell(sheet, cell)
    },
  })

  expandFormulas(sheet)
  return sheet
}

const ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
}

export const encodeText = (text: string): string =>
  text.replace(/[&<>"]/gu, (one) => ESCAPES[one] ?? one)

const attribute = (name: string, value: string | number | null): string =>
  value === null ? '' : ` ${name}="${encodeText(String(value))}"`

const carriedAttributes = (carried: Record<string, string> | null): string =>
  carried === null
    ? ''
    : Object.entries(carried)
        .map(([name, value]) => attribute(name, value))
        .join('')

function cellXml(cell: Cell, masters: Map<number, SharedMaster>): string {
  const reference = formatReference({ row: cell.row, column: cell.column })
  const head =
    `<c r="${reference}"` +
    attribute('s', cell.style) +
    (cell.type === 'n' ? '' : ` t="${cell.type}"`) +
    carriedAttributes(cell.carried)

  // Collapsed back to what the file had: one text for a shared group and one
  // for an array, rather than the copy every cell was given on the way in.
  const written = collapsedFormula(cell, masters)

  const formula =
    written === null
      ? ''
      : `<f${written.kind === 'normal' ? '' : ` t="${written.kind}"`}` +
        attribute('ref', written.ref) +
        attribute('si', written.shared) +
        carriedAttributes(written.carried) +
        (written.text === '' ? '/>' : `>${encodeText(written.text)}</f>`)

  // A rich string goes back as the markup it came from: rebuilding an `<rPr>`
  // would rebuild only the parts of it this understands.
  const source = cell.rich?.source ?? null

  const value =
    source !== null
      ? `<is>${source}</is>`
      : cell.value === null
        ? ''
        : cell.type === 'inlineStr'
          ? `<is><t>${encodeText(cell.value)}</t></is>`
          : `<v>${encodeText(cell.value)}</v>`

  const body = `${formula}${value}`
  return body === '' ? `${head}/>` : `${head}>${body}</c>`
}

function rowXml(
  row: RowProperties | undefined,
  index: number,
  cells: readonly Cell[],
  masters: Map<number, SharedMaster>,
): string {
  const head =
    `<row r="${String(index + 1)}"` +
    (row === undefined
      ? ''
      : attribute('ht', row.height) +
        (row.customHeight ? ' customHeight="1"' : '') +
        (row.hidden ? ' hidden="1"' : '') +
        attribute('outlineLevel', row.outlineLevel) +
        (row.style === null ? '' : ` s="${String(row.style)}" customFormat="1"`) +
        (row.collapsed ? ' collapsed="1"' : '') +
        carriedAttributes(row.carried))

  const body = cells.map((cell) => cellXml(cell, masters)).join('')
  return body === '' ? `${head}/>` : `${head}>${body}</row>`
}

/**
 * The model as `sheetData`, written in one pass.
 *
 * Regenerated rather than patched, which the ADR explains: there is no tree to
 * patch, because a streaming reader never built one. Rows come out in order
 * and cells left to right, because a sheet that says otherwise is one Excel
 * sorts on save — turning a one-cell edit into a whole-file diff.
 */
export function writeSheetData(sheet: SheetCells): string {
  const indexes = new Set([...sheet.rows.keys(), ...sheet.properties.keys()])
  const ordered = [...indexes].sort((a, b) => a - b)
  const masters = sharedMasters(sheet)

  const rows = ordered
    .map((index) => {
      const cells = [...(sheet.rows.get(index) ?? new Map<number, Cell>()).values()].sort(
        (a, b) => a.column - b.column,
      )
      return rowXml(sheet.properties.get(index), index, cells, masters)
    })
    .join('')

  return rows === '' ? '<sheetData/>' : `<sheetData>${rows}</sheetData>`
}

/**
 * The part without its cells, for the readers that are about everything else.
 *
 * Nothing else in a worksheet is inside `sheetData`: the views, the columns,
 * the merges, the rules, the validations, the page setup and the hyperlinks
 * are all its siblings. A reader after those that hands the whole part to an
 * XML parser builds a tree of two hundred thousand `<c>` elements to walk
 * past them — which is the cost this file exists to avoid, paid again by the
 * parts of the file that have no use for the cells at all.
 *
 * Cut as text, because a parser that could be told to skip an element would
 * have to be told by every caller that ever parses a sheet.
 */
export const withoutCells = (xml: string): string =>
  xml.replace(elementPattern('sheetData'), '<sheetData/>')

/**
 * A worksheet with its cells replaced and everything else left alone.
 *
 * Textual on purpose: every other element of the part keeps its own bytes,
 * including the ones nothing here has heard of, and the diff of a saved file
 * is the cells and nothing else.
 */
export function replaceSheetData(xml: string, sheet: SheetCells): string {
  const match = elementPattern('sheetData').exec(xml)
  if (match === null) return xml

  return (
    xml.slice(0, match.index) + writeSheetData(sheet) + xml.slice(match.index + match[0].length)
  )
}
