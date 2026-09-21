import {
  attribute,
  children,
  element,
  findChild,
  findChildren,
  removeAttribute,
  setAttribute,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * Changing the shape of a table.
 *
 * A table is a grid that states itself completely: every row lists a cell for
 * every column, whether or not anything is drawn there. A merged cell is not
 * removed — it stays, marked as swallowed — and a row with a cell missing is a
 * file PowerPoint refuses to open. So every operation here adds and marks; none
 * of them takes a `a:tc` away, except when a whole row or column goes.
 *
 * The grid and the rows have to agree. `a:tblGrid` says how many columns there
 * are and how wide, and every `a:tr` must have that many `a:tc`; the two are
 * changed together or not at all.
 */

/** A cell with the empty paragraph and properties every one is required to have. */
function emptyCell(): XmlNode {
  return element('a:tc', {}, [
    element('a:txBody', {}, [
      element('a:bodyPr'),
      element('a:lstStyle'),
      element('a:p', {}, [element('a:endParaRPr', { lang: 'en-US' })]),
    ]),
    element('a:tcPr'),
  ])
}

const rowsOf = (table: XmlNode): XmlNode[] => findChildren(table, 'a:tr')
const cellsOf = (row: XmlNode): XmlNode[] => findChildren(row, 'a:tc')

function grid(table: XmlNode): XmlNode | undefined {
  return findChild(table, 'a:tblGrid')
}

/** How many columns the grid says there are. */
export function columnCount(table: XmlNode): number {
  const found = grid(table)
  return found === undefined ? 0 : findChildren(found, 'a:gridCol').length
}

export function rowCount(table: XmlNode): number {
  return rowsOf(table).length
}

/**
 * Adds a row, copying the height of the one it is put beside.
 *
 * `at` is the row to work from and `below` says which side. A new row is empty
 * rather than a copy: duplicating a row is a different thing people ask for by
 * name, and quietly doing it here would make "add a row" mean two things.
 */
export function insertRow(table: XmlNode, at: number, below = true): boolean {
  const rows = rowsOf(table)
  const columns = columnCount(table)
  if (columns === 0) return false

  const neighbour = rows[Math.min(Math.max(at, 0), rows.length - 1)]
  const height = neighbour === undefined ? undefined : attribute(neighbour, 'h')

  const made = element(
    'a:tr',
    height === undefined ? {} : { h: height },
    Array.from({ length: columns }, () => emptyCell()),
  )

  const siblings = children(table)
  const index = neighbour === undefined ? siblings.length : siblings.indexOf(neighbour)
  siblings.splice(index + (below ? 1 : 0), 0, made)
  return true
}

/** Removes a row. The last one cannot go: a table with no rows is not a table. */
export function removeRow(table: XmlNode, at: number): boolean {
  const rows = rowsOf(table)
  const row = rows[at]
  if (row === undefined || rows.length <= 1) return false

  const siblings = children(table)
  siblings.splice(siblings.indexOf(row), 1)
  return true
}

/**
 * Adds a column, giving it the width of the one it is put beside.
 *
 * The grid and every row change together: a grid of five columns over rows of
 * four cells is the file PowerPoint offers to repair.
 */
export function insertColumn(table: XmlNode, at: number, after = true): boolean {
  const found = grid(table)
  if (found === undefined) return false

  const columns = findChildren(found, 'a:gridCol')
  const neighbour = columns[Math.min(Math.max(at, 0), columns.length - 1)]
  if (neighbour === undefined) return false

  const width = attribute(neighbour, 'w')
  const made = element('a:gridCol', width === undefined ? {} : { w: width })

  const gridChildren = children(found)
  const index = gridChildren.indexOf(neighbour) + (after ? 1 : 0)
  gridChildren.splice(index, 0, made)

  for (const row of rowsOf(table)) {
    const cells = children(row)
    const existing = cellsOf(row)[Math.min(Math.max(at, 0), columns.length - 1)]
    const where = existing === undefined ? cells.length : cells.indexOf(existing) + (after ? 1 : 0)
    cells.splice(where, 0, emptyCell())
  }

  return true
}

export function removeColumn(table: XmlNode, at: number): boolean {
  const found = grid(table)
  if (found === undefined) return false

  const columns = findChildren(found, 'a:gridCol')
  const column = columns[at]
  if (column === undefined || columns.length <= 1) return false

  const gridChildren = children(found)
  gridChildren.splice(gridChildren.indexOf(column), 1)

  for (const row of rowsOf(table)) {
    const cells = children(row)
    const cell = cellsOf(row)[at]
    if (cell !== undefined) cells.splice(cells.indexOf(cell), 1)
  }

  return true
}

export interface CellRange {
  row: number
  column: number
  /** Inclusive. */
  toRow: number
  toColumn: number
}

/**
 * Merges a rectangle of cells into the one at its top left.
 *
 * The swallowed cells stay in the file, marked `hMerge` or `vMerge`. That is
 * not an implementation detail to tidy away later: the grid has to stay
 * rectangular, and a reader counts cells to know which column it is looking at.
 */
export function mergeCells(table: XmlNode, range: CellRange): boolean {
  const rows = rowsOf(table)
  const top = Math.min(range.row, range.toRow)
  const bottom = Math.max(range.row, range.toRow)
  const left = Math.min(range.column, range.toColumn)
  const right = Math.max(range.column, range.toColumn)
  if (top === bottom && left === right) return false

  const anchor = cellsOf(rows[top] ?? element('a:tr'))[left]
  if (anchor === undefined) return false

  const width = right - left + 1
  const height = bottom - top + 1
  if (width > 1) setAttribute(anchor, 'gridSpan', String(width))
  if (height > 1) setAttribute(anchor, 'rowSpan', String(height))

  for (let rowIndex = top; rowIndex <= bottom; rowIndex += 1) {
    const row = rows[rowIndex]
    if (row === undefined) continue

    for (let column = left; column <= right; column += 1) {
      const cell = cellsOf(row)[column]
      if (cell === undefined || cell === anchor) continue

      // A cell swallowed sideways says `hMerge`; one swallowed from above says
      // `vMerge`; a cell in the middle of a block says both.
      if (column > left) setAttribute(cell, 'hMerge', '1')
      if (rowIndex > top) setAttribute(cell, 'vMerge', '1')
    }
  }

  return true
}

/** Undoes a merge, giving every swallowed cell back its own square. */
export function splitCell(table: XmlNode, row: number, column: number): boolean {
  const rows = rowsOf(table)
  const anchor = cellsOf(rows[row] ?? element('a:tr'))[column]
  if (anchor === undefined) return false

  const width = Number(attribute(anchor, 'gridSpan') ?? '1')
  const height = Number(attribute(anchor, 'rowSpan') ?? '1')
  if (width <= 1 && height <= 1) return false

  removeAttribute(anchor, 'gridSpan')
  removeAttribute(anchor, 'rowSpan')

  for (let rowIndex = row; rowIndex < row + height; rowIndex += 1) {
    const current = rows[rowIndex]
    if (current === undefined) continue

    for (let index = column; index < column + width; index += 1) {
      const cell = cellsOf(current)[index]
      if (cell === undefined || cell === anchor) continue
      removeAttribute(cell, 'hMerge')
      removeAttribute(cell, 'vMerge')
    }
  }

  return true
}
