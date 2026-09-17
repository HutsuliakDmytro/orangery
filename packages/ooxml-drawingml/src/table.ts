import { attribute, children, findChild, tagName, textValue } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { readFill } from './shape-properties'
import type { Fill, Line } from './shape-properties'
import { readLine } from './shape-properties'
import { readTextBody } from './text-body'
import type { TextBody } from './text-body'

/**
 * `a:tbl` — a table, in the DrawingML spelling both formats use inside a shape.
 *
 * Merged cells are the part worth reading carefully. A merge does not remove
 * cells: the top-left cell of the block carries `gridSpan` or `rowSpan`, and
 * every cell it swallowed is still there, marked `hMerge` or `vMerge`. They
 * must not be drawn, and they must not be dropped either — the grid would stop
 * lining up and PowerPoint would refuse the file.
 */

const count = (value: string | undefined, fallback: number): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

const flag = (value: string | undefined): boolean => value === '1' || value === 'true'

export interface CellProperties {
  /** Padding in EMU; null where the cell does not state it. */
  insets: { left: number | null; top: number | null; right: number | null; bottom: number | null }
  /** `t`, `ctr`, `b`. */
  anchor: string | null
  fill: Fill | null
  borders: {
    left: Line | null
    right: Line | null
    top: Line | null
    bottom: Line | null
  }
}

const emu = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function readBorder(properties: XmlNode, tag: string): Line | null {
  const element = findChild(properties, tag)
  return element === undefined ? null : readLine(element)
}

export function readCellProperties(properties: XmlNode): CellProperties {
  const fill = children(properties).find((child) =>
    /^a:(no|solid|grad|patt|blip|grp)Fill$/u.test(tagName(child) ?? ''),
  )

  return {
    insets: {
      left: emu(attribute(properties, 'marL')),
      top: emu(attribute(properties, 'marT')),
      right: emu(attribute(properties, 'marR')),
      bottom: emu(attribute(properties, 'marB')),
    },
    anchor: attribute(properties, 'anchor') ?? null,
    fill: fill === undefined ? null : readFill(fill),
    borders: {
      left: readBorder(properties, 'a:lnL'),
      right: readBorder(properties, 'a:lnR'),
      top: readBorder(properties, 'a:lnT'),
      bottom: readBorder(properties, 'a:lnB'),
    },
  }
}

export interface TableCell {
  text: TextBody | null
  /** How many columns this cell covers, counting itself. */
  gridSpan: number
  rowSpan: number
  /** True for a cell swallowed by the one to its left. Present in the file, not drawn. */
  horizontallyMerged: boolean
  /** True for a cell swallowed by the one above it. */
  verticallyMerged: boolean
  properties: CellProperties | null
  node: XmlNode
}

function readCell(node: XmlNode): TableCell {
  const text = findChild(node, 'a:txBody')
  const properties = findChild(node, 'a:tcPr')

  return {
    text: text === undefined ? null : readTextBody(text),
    gridSpan: count(attribute(node, 'gridSpan'), 1),
    rowSpan: count(attribute(node, 'rowSpan'), 1),
    horizontallyMerged: flag(attribute(node, 'hMerge')),
    verticallyMerged: flag(attribute(node, 'vMerge')),
    properties: properties === undefined ? null : readCellProperties(properties),
    node,
  }
}

export interface TableRow {
  /** Height in EMU. A row grows past this to fit its text, as PowerPoint does. */
  height: number | null
  cells: TableCell[]
  node: XmlNode
}

export interface TableProperties {
  /** The first row is styled as a header. */
  firstRow: boolean
  firstColumn: boolean
  lastRow: boolean
  lastColumn: boolean
  bandedRows: boolean
  bandedColumns: boolean
  /** A GUID into `ppt/tableStyles.xml`. */
  styleId: string | null
}

export interface Table {
  properties: TableProperties
  /** Column widths in EMU. Their count is the grid width. */
  columns: number[]
  rows: TableRow[]
  node: XmlNode
}

function readTableProperties(element: XmlNode | undefined): TableProperties {
  const style = element === undefined ? undefined : findChild(element, 'a:tableStyleId')
  const styleId =
    style === undefined
      ? null
      : children(style)
          .map((child) => textValue(child))
          .join('')

  return {
    firstRow: element === undefined ? false : flag(attribute(element, 'firstRow')),
    firstColumn: element === undefined ? false : flag(attribute(element, 'firstCol')),
    lastRow: element === undefined ? false : flag(attribute(element, 'lastRow')),
    lastColumn: element === undefined ? false : flag(attribute(element, 'lastCol')),
    bandedRows: element === undefined ? false : flag(attribute(element, 'bandRow')),
    bandedColumns: element === undefined ? false : flag(attribute(element, 'bandCol')),
    styleId: styleId === null || styleId === '' ? null : styleId,
  }
}

export function readTable(node: XmlNode): Table {
  const grid = findChild(node, 'a:tblGrid')

  return {
    properties: readTableProperties(findChild(node, 'a:tblPr')),
    columns: (grid === undefined ? [] : children(grid))
      .filter((column) => tagName(column) === 'a:gridCol')
      .map((column) => emu(attribute(column, 'w')) ?? 0),
    rows: children(node)
      .filter((row) => tagName(row) === 'a:tr')
      .map((row) => ({
        height: emu(attribute(row, 'h')),
        cells: children(row)
          .filter((cell) => tagName(cell) === 'a:tc')
          .map(readCell),
        node: row,
      })),
    node,
  }
}

/**
 * The cells that are actually drawn: the origin of each merged block, and every
 * unmerged cell. The ones left out are still in the file and written back.
 */
export function visibleCells(row: TableRow): TableCell[] {
  return row.cells.filter((cell) => !cell.horizontallyMerged && !cell.verticallyMerged)
}
