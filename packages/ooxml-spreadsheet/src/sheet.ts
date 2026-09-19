import {
  attribute,
  buildXml,
  children,
  element,
  findChild,
  getPartText,
  parseXml,
  setAttribute,
  setPartText,
  tagName,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { formatReference, indexToColumn, parseReference } from './reference'
import { textOf } from './workbook'

/**
 * A worksheet, and the cells in it.
 *
 * Opened, changed and written back rather than modelled and regenerated: a
 * sheet carries column widths, styles, merged ranges, conditional formatting
 * and a dozen other things nothing here understands, and a sheet rebuilt from
 * "these cells held these numbers" would lose every one of them.
 *
 * What this does understand is a cell holding a number or a word, which is all
 * a chart's workbook ever holds.
 */

export interface Sheet {
  path: string
  /** Everything the part holds, so it can be written back whole. */
  roots: XmlNode[]
  root: XmlNode
  data: XmlNode
}

export type CellValue = number | string | null

export function openSheet(pkg: OoxmlPackage, path: string): Sheet | null {
  const roots = parseXml(getPartText(pkg, path) ?? '')
  const root = roots.find((node) => tagName(node) === 'worksheet')
  const data = root === undefined ? undefined : findChild(root, 'sheetData')

  return root === undefined || data === undefined ? null : { path, roots, root, data }
}

/** Writes the sheet back into the package it came from. */
export function saveSheet(pkg: OoxmlPackage, sheet: Sheet): void {
  setPartText(pkg, sheet.path, withDeclaration(buildXml(sheet.roots)))
}

const rowsOf = (sheet: Sheet): XmlNode[] =>
  children(sheet.data).filter((child) => tagName(child) === 'row')

const rowNumber = (row: XmlNode): number => Number(attribute(row, 'r'))

const cellsOf = (row: XmlNode): XmlNode[] => children(row).filter((child) => tagName(child) === 'c')

/** The column a cell sits in, from its own reference. */
const columnOf = (cell: XmlNode): number =>
  parseReference(attribute(cell, 'r') ?? '')?.column ?? Number.MAX_SAFE_INTEGER

/**
 * What a cell holds.
 *
 * `t` says how to read the `v`: a shared string is an index into the table, a
 * number is itself, and an inline string keeps its words in the cell. A cell
 * whose type says `s` and whose value is read as a number is the classic way to
 * show 4 where Q1 was meant.
 */
export function readCell(sheet: Sheet, reference: string, strings: readonly string[]): CellValue {
  const position = parseReference(reference)
  if (position === null) return null

  const row = rowsOf(sheet).find((one) => rowNumber(one) === position.row + 1)
  const cell =
    row === undefined ? undefined : cellsOf(row).find((one) => columnOf(one) === position.column)
  if (cell === undefined) return null

  const type = attribute(cell, 't') ?? 'n'
  if (type === 'inlineStr') return textOf(findChild(cell, 'is') ?? {})

  const value = findChild(cell, 'v')
  const text = value === undefined ? '' : textOf(value)
  if (text === '') return null

  switch (type) {
    case 's': {
      const index = Number(text)
      return strings[index] ?? null
    }
    case 'str':
      return text
    case 'b':
      return text === '1' ? 'TRUE' : 'FALSE'
    case 'e':
      return text
    default: {
      const parsed = Number(text)
      return Number.isFinite(parsed) ? parsed : null
    }
  }
}

/**
 * Puts a value into a cell, making the row and the cell if they are not there.
 *
 * Words are written as an inline string rather than added to the shared table:
 * adding to the table means keeping its `count` and `uniqueCount` right, and
 * every other cell's index stable, for a gain nobody can see. An inline string
 * is what the format offers for exactly this.
 *
 * The type attribute is rewritten with the value, or a cell that held a shared
 * string would have its new number read as an index into the table.
 */
export function writeCell(sheet: Sheet, reference: string, value: number | string): boolean {
  const position = parseReference(reference)
  if (position === null) return false

  const row = rowFor(sheet, position.row)
  const cell = cellFor(row, position)

  const nodes = children(cell)
  nodes.length = 0

  if (typeof value === 'number') {
    nodes.push(element('v', {}, [{ '#text': String(value) }]))
    setAttribute(cell, 't', 'n')
  } else {
    nodes.push(element('is', {}, [element('t', {}, [{ '#text': value }])]))
    setAttribute(cell, 't', 'inlineStr')
  }

  widenDimension(sheet, position.row, position.column)
  return true
}

/**
 * Empties a cell, leaving the row it was in.
 *
 * The element goes rather than its value: a sheet states the cells it has, and
 * a `<c>` with no `<v>` is a cell holding an empty string in some readers and
 * nothing in others. Absent is the one form everybody agrees about.
 */
export function clearCell(sheet: Sheet, reference: string): boolean {
  const position = parseReference(reference)
  if (position === null) return false

  const row = rowsOf(sheet).find((one) => rowNumber(one) === position.row + 1)
  if (row === undefined) return false

  const siblings = children(row)
  const at = siblings.findIndex((cell) => attribute(cell, 'r') === reference)
  if (at === -1) return false

  siblings.splice(at, 1)
  return true
}

/** The row with this number, inserted in order when the sheet has none. */
function rowFor(sheet: Sheet, index: number): XmlNode {
  const existing = rowsOf(sheet).find((row) => rowNumber(row) === index + 1)
  if (existing !== undefined) return existing

  const made = element('row', { r: String(index + 1) })
  const siblings = children(sheet.data)
  const after = siblings.findIndex((row) => rowNumber(row) > index + 1)

  // Rows are written in order. Excel reads an out-of-order sheet, and then
  // writes it back sorted, which turns a one-cell edit into a whole-file diff.
  siblings.splice(after === -1 ? siblings.length : after, 0, made)
  return made
}

/** The cell at this position in a row, inserted in column order when missing. */
function cellFor(row: XmlNode, position: { row: number; column: number }): XmlNode {
  const reference = formatReference(position)
  const existing = cellsOf(row).find((cell) => attribute(cell, 'r') === reference)
  if (existing !== undefined) return existing

  const made = element('c', { r: reference })
  const siblings = children(row)
  const after = siblings.findIndex((cell) => columnOf(cell) > position.column)

  siblings.splice(after === -1 ? siblings.length : after, 0, made)
  return made
}

/**
 * Grows the stated extent of the sheet to include a cell.
 *
 * Never shrinks it: `dimension` is a hint Excel recomputes, and a narrowed one
 * on a sheet whose other cells this never looked at would be a lie.
 */
function widenDimension(sheet: Sheet, row: number, column: number): void {
  const dimension = findChild(sheet.root, 'dimension')
  const stated = attribute(dimension ?? {}, 'ref')
  if (dimension === undefined || stated === undefined) return

  const [first, second] = stated.split(':')
  const from = parseReference(first ?? '')
  const to = parseReference(second ?? first ?? '')
  if (from === null || to === null) return

  const start = formatReference({
    row: Math.min(from.row, row),
    column: Math.min(from.column, column),
  })
  const end = formatReference({ row: Math.max(to.row, row), column: Math.max(to.column, column) })

  setAttribute(dimension, 'ref', `${start}:${end}`)
}

/**
 * Adds a row at this index, or takes one away.
 *
 * Everything below moves, and so does every cell in it: a sheet where two rows
 * call themselves the fourth is one Excel offers to repair. The new row is
 * shaped like the one it goes in front of — the columns of a table are the same
 * all the way down — and its cells are given the value asked for.
 */
export function insertRow(
  sheet: Sheet,
  index: number,
  fill: (column: number) => number | string,
): boolean {
  const siblings = children(sheet.data)
  const at = siblings.findIndex((row) => rowNumber(row) === index + 1)
  const template = at === -1 ? undefined : siblings[at]
  if (template === undefined) return false

  const made = element(
    'row',
    { r: String(index + 1) },
    cellsOf(template).flatMap((cell) => {
      const position = parseReference(attribute(cell, 'r') ?? '')
      if (position === null) return []

      const value = fill(position.column)
      const reference = formatReference({ row: index, column: position.column })

      return [
        typeof value === 'number'
          ? element('c', { r: reference, t: 'n' }, [element('v', {}, [{ '#text': String(value) }])])
          : element('c', { r: reference, t: 'inlineStr' }, [
              element('is', {}, [element('t', {}, [{ '#text': value }])]),
            ]),
      ]
    }),
  )

  siblings.splice(at, 0, made)
  renumber(siblings, index + 1, 1, at)
  return true
}

export function removeRow(sheet: Sheet, index: number): boolean {
  const siblings = children(sheet.data)
  const at = siblings.findIndex((row) => rowNumber(row) === index + 1)
  if (at === -1) return false

  siblings.splice(at, 1)
  renumber(siblings, index + 1, -1, -1)
  return true
}

/** Moves every row from `from` down or up by one, cells included. */
function renumber(rows: readonly XmlNode[], from: number, by: number, skip: number): void {
  for (const [position, row] of rows.entries()) {
    const number = rowNumber(row)
    if (!Number.isFinite(number) || number < from || position === skip) continue

    const moved = number + by
    setAttribute(row, 'r', String(moved))

    for (const cell of cellsOf(row)) {
      const reference = parseReference(attribute(cell, 'r') ?? '')
      if (reference === null) continue
      setAttribute(cell, 'r', `${indexToColumn(reference.column)}${String(moved)}`)
    }
  }
}
