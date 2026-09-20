import {
  attribute,
  children,
  findChild,
  getPartText,
  parseXml,
  tagName,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { indexToColumn, parseRange } from './reference'
import type { CellRange } from './reference'

/**
 * A table — the thing Excel calls `Table1` and a formula calls by name.
 *
 * Not a style: a range becomes a table and then rows added at its edge join
 * it, a formula written into one column fills the rest, and `Table1[Revenue]`
 * means a column rather than a range of cells. Nothing here does any of that
 * yet; what it does is read the table so the parts that will can find it.
 *
 * Each table is a part of its own, pointed at from the sheet it sits on.
 */

export interface TableColumn {
  /** `Revenue` — what a structured reference calls it. */
  name: string
  id: string | null
  /** `sum`, `average`, `count`… on the totals row, or null for none. */
  totalsFunction: string | null
  totalsLabel: string | null
  /** The formula every cell of the column carries, for a calculated column. */
  formula: string | null
}

export interface TableStyle {
  name: string | null
  firstColumn: boolean
  lastColumn: boolean
  rowStripes: boolean
  columnStripes: boolean
}

export interface Table {
  /** `Table1` — the name used in formulas, which is not the display name. */
  name: string
  displayName: string
  range: CellRange
  /** Usually one; a table can state that it has no header at all. */
  headerRows: number
  totalsRows: number
  columns: TableColumn[]
  style: TableStyle
  /** Whether the header row carries the filter arrows. */
  filtered: boolean
}

const number = (node: XmlNode | undefined, name: string, fallback: number): number => {
  const value = Number(attribute(node ?? {}, name))
  return Number.isFinite(value) ? value : fallback
}

const flag = (node: XmlNode | undefined, name: string, fallback = false): boolean => {
  const value = attribute(node ?? {}, name)
  if (value === undefined) return fallback
  return value === '1' || value === 'true'
}

function readColumns(root: XmlNode): TableColumn[] {
  const columns = findChild(root, 'tableColumns')
  if (columns === undefined) return []

  return children(columns).flatMap((column) => {
    if (tagName(column) !== 'tableColumn') return []

    const name = attribute(column, 'name')
    if (name === undefined) return []

    const calculated = findChild(column, 'calculatedColumnFormula')

    return [
      {
        name,
        id: attribute(column, 'id') ?? null,
        totalsFunction: attribute(column, 'totalsRowFunction') ?? null,
        totalsLabel: attribute(column, 'totalsRowLabel') ?? null,
        formula:
          calculated === undefined
            ? null
            : children(calculated)
                .map((child) => (typeof child['#text'] === 'string' ? child['#text'] : ''))
                .join(''),
      },
    ]
  })
}

export function readTable(xml: string): Table | null {
  const root = parseXml(xml).find((node) => tagName(node) === 'table')
  if (root === undefined) return null

  const range = parseRange(attribute(root, 'ref') ?? '')
  const name = attribute(root, 'name')
  if (range === null || name === undefined) return null

  const style = findChild(root, 'tableStyleInfo')

  return {
    name,
    displayName: attribute(root, 'displayName') ?? name,
    range,
    // A table has a header row unless it says otherwise, which is why the
    // fallback is one rather than nought.
    headerRows: number(root, 'headerRowCount', 1),
    totalsRows: number(root, 'totalsRowCount', 0),
    columns: readColumns(root),
    style: {
      name: attribute(style ?? {}, 'name') ?? null,
      firstColumn: flag(style, 'showFirstColumn'),
      lastColumn: flag(style, 'showLastColumn'),
      rowStripes: flag(style, 'showRowStripes'),
      columnStripes: flag(style, 'showColumnStripes'),
    },
    filtered: findChild(root, 'autoFilter') !== undefined,
  }
}

/** Every table of a package, wherever its sheets keep them. */
export function readTables(pkg: OoxmlPackage): Table[] {
  return [...pkg.parts.keys()]
    .filter((path) => /^xl\/tables\/table\d+\.xml$/u.test(path))
    .sort()
    .flatMap((path) => {
      const table = readTable(getPartText(pkg, path) ?? '')
      return table === null ? [] : [table]
    })
}

/** The table a cell falls inside, or null — which is most cells. */
export function tableAt(
  tables: readonly Table[],
  cell: { row: number; column: number },
): Table | null {
  return (
    tables.find(
      (table) =>
        cell.row >= table.range.from.row &&
        cell.row <= table.range.to.row &&
        cell.column >= table.range.from.column &&
        cell.column <= table.range.to.column,
    ) ?? null
  )
}

const escaped = (text: string): string =>
  text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')

const reference = (range: CellRange): string => {
  const from = `${indexToColumn(range.from.column)}${String(range.from.row + 1)}`
  const to = `${indexToColumn(range.to.column)}${String(range.to.row + 1)}`
  return `${from}:${to}`
}

/**
 * A table as the part that holds it.
 *
 * The `id` and the `name` are the same number and the same word in every
 * table Excel writes, and the display name is what a person renames; keeping
 * all three is how a file written here reads the same as one written there.
 *
 * A totals row is stated twice — once in `totalsRowCount` and once in each
 * column that has a function — because the row exists whether or not every
 * column totals anything.
 */
export function writeTable(table: Table, id: number): string {
  const columns = table.columns
    .map((column, at) => {
      const totals =
        column.totalsFunction === null
          ? ''
          : ` totalsRowFunction="${escaped(column.totalsFunction)}"`
      const label =
        column.totalsLabel === null ? '' : ` totalsRowLabel="${escaped(column.totalsLabel)}"`
      const formula =
        column.formula === null
          ? ''
          : `<calculatedColumnFormula>${escaped(column.formula)}</calculatedColumnFormula>`

      return (
        `<tableColumn id="${column.id ?? String(at + 1)}" name="${escaped(column.name)}"` +
        `${totals}${label}${formula === '' ? '/>' : `>${formula}</tableColumn>`}`
      )
    })
    .join('')

  const style = table.style
  const styleInfo =
    style.name === null
      ? ''
      : `<tableStyleInfo name="${escaped(style.name)}" ` +
        `showFirstColumn="${style.firstColumn ? '1' : '0'}" ` +
        `showLastColumn="${style.lastColumn ? '1' : '0'}" ` +
        `showRowStripes="${style.rowStripes ? '1' : '0'}" ` +
        `showColumnStripes="${style.columnStripes ? '1' : '0'}"/>`

  const filter = table.filtered ? `<autoFilter ref="${reference(table.range)}"/>` : ''
  const totalsRow = table.totalsRows > 0 ? ` totalsRowCount="${String(table.totalsRows)}"` : ''

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<table xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    `id="${String(id)}" name="${escaped(table.name)}" displayName="${escaped(table.displayName)}" ` +
    `ref="${reference(table.range)}" headerRowCount="${String(table.headerRows)}"${totalsRow}>` +
    `${filter}<tableColumns count="${String(table.columns.length)}">${columns}</tableColumns>` +
    `${styleInfo}</table>`
  )
}

/**
 * The tables a sheet points at, written into it.
 *
 * `<tableParts>` goes last of all — after the drawing, before the extension
 * list — and names each table by relationship. A table part nothing points at
 * is a table Excel will not show.
 */
export function replaceTableParts(xml: string, relationshipIds: readonly string[]): string {
  const written =
    relationshipIds.length === 0
      ? ''
      : `<tableParts count="${String(relationshipIds.length)}">${relationshipIds
          .map((id) => `<tablePart r:id="${escaped(id)}"/>`)
          .join('')}</tableParts>`

  const existing = /<tableParts(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/tableParts>)/u.exec(xml)
  if (existing !== null) {
    return xml.slice(0, existing.index) + written + xml.slice(existing.index + existing[0].length)
  }

  if (written === '') return xml

  const before = /<extLst/u.exec(xml)
  if (before !== null) return xml.slice(0, before.index) + written + xml.slice(before.index)

  const at = xml.lastIndexOf('</worksheet>')
  return at === -1 ? xml : xml.slice(0, at) + written + xml.slice(at)
}

/**
 * A name nothing else in the workbook has taken.
 *
 * Tables share one namespace with defined names, which is why a workbook
 * with a table called `Sales` cannot also have a name called `Sales` — and
 * why this takes both lists.
 */
export function freeTableName(taken: readonly string[]): string {
  const used = new Set(taken.map((one) => one.toLowerCase()))

  let at = 1
  while (used.has(`table${String(at)}`)) at += 1

  return `Table${String(at)}`
}
