import {
  attribute,
  children,
  findChild,
  getPartText,
  parseXml,
  tagName,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { parseRange } from './reference'
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
