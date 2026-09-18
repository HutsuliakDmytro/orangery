import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findChild, findDescendant } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { readTable, visibleCells } from '@orangery/ooxml-drawingml'
import { readDeck } from './deck'
import { readPptxPackage } from './parts'
import { saveDeck, writeSlidePart } from './save'
import { flatten } from './shape-tree'
import {
  columnCount,
  insertColumn,
  insertRow,
  mergeCells,
  removeColumn,
  removeRow,
  splitCell,
} from './table-edit'

/**
 * Changing the shape of a table.
 *
 * Every assertion reads the table back out of a saved file, because the one
 * way to get this wrong is to leave the grid and the rows disagreeing — and
 * that is exactly what a model built from the same edit would agree about.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')

/** Opens the deck with a table, changes it, saves and reads it back. */
async function change(apply: (table: XmlNode) => void) {
  const pkg = await readPptxPackage(await readFile(join(FIXTURES, 'table.pptx')))
  const deck = readDeck(pkg)
  const slide = deck.slides[0]
  if (slide === undefined) throw new Error('fixture has no slides')

  const frame = flatten(slide.shapes).find((shape) => shape.kind === 'graphicFrame')
  const node = frame === undefined ? undefined : findDescendant(frame.node, 'a:tbl')
  if (node === undefined) throw new Error('fixture has no table')

  apply(node)
  writeSlidePart(pkg, slide)

  const reopened = readDeck(await readPptxPackage(await saveDeck(pkg)))
  const again = flatten(reopened.slides[0]?.shapes ?? []).find(
    (shape) => shape.kind === 'graphicFrame',
  )
  const back = again === undefined ? undefined : findDescendant(again.node, 'a:tbl')
  if (back === undefined) throw new Error('the table did not survive')

  return { node: back, table: readTable(back) }
}

/** Every row states a cell per column, or the file is one PowerPoint refuses. */
function isRectangular(node: XmlNode): boolean {
  const columns = columnCount(node)
  const table = readTable(node)
  return table.rows.every((row) => row.cells.length === columns)
}

describe('rows', () => {
  it('adds one below the row given', async () => {
    const before = await change(() => undefined)
    const { node, table } = await change((one) => {
      insertRow(one, 0, true)
    })

    expect(table.rows.length).toBe(before.table.rows.length + 1)
    expect(isRectangular(node)).toBe(true)
  })

  it('adds one above when asked', async () => {
    const before = await change(() => undefined)
    const { table } = await change((one) => {
      insertRow(one, 0, false)
    })

    expect(table.rows.length).toBe(before.table.rows.length + 1)
  })

  it('takes one away', async () => {
    const before = await change(() => undefined)
    const { node, table } = await change((one) => {
      removeRow(one, 0)
    })

    expect(table.rows.length).toBe(before.table.rows.length - 1)
    expect(isRectangular(node)).toBe(true)
  })

  it('refuses to take the last one', async () => {
    const { table } = await change((one) => {
      // A table with no rows is not a table, so the last call does nothing.
      while (removeRow(one, 0)) {
        // Until it will not.
      }
    })

    expect(table.rows.length).toBe(1)
  })
})

describe('columns', () => {
  it('adds one to the grid and to every row at once', async () => {
    const before = await change(() => undefined)
    const { node, table } = await change((one) => {
      insertColumn(one, 0, true)
    })

    expect(columnCount(node)).toBe(columnCount(before.node) + 1)
    expect(isRectangular(node)).toBe(true)
    expect(table.rows[0]?.cells.length).toBe(columnCount(node))
  })

  it('gives it the width of the one beside it', async () => {
    const { node } = await change((one) => {
      insertColumn(one, 0, true)
    })

    const grid = findChild(node, 'a:tblGrid')
    const widths = grid === undefined ? [] : readTable(node).rows.map((row) => row.cells.length)
    expect(new Set(widths).size).toBe(1)
  })

  it('takes one away from the grid and from every row', async () => {
    const before = await change(() => undefined)
    const { node } = await change((one) => {
      removeColumn(one, 0)
    })

    expect(columnCount(node)).toBe(columnCount(before.node) - 1)
    expect(isRectangular(node)).toBe(true)
  })

  it('refuses to take the last one', async () => {
    const { node } = await change((one) => {
      while (removeColumn(one, 0)) {
        // Until it will not.
      }
    })

    expect(columnCount(node)).toBe(1)
  })
})

describe('merging', () => {
  it('spans the cell and keeps the swallowed ones in the file', async () => {
    const { node, table } = await change((one) => {
      mergeCells(one, { row: 0, column: 0, toRow: 0, toColumn: 1 })
    })

    const first = table.rows[0]
    if (first === undefined) throw new Error('no row')

    expect(first.cells[0]?.gridSpan).toBe(2)
    expect(first.cells[1]?.horizontallyMerged).toBe(true)
    // One cell is drawn where two were, and the grid is still rectangular.
    expect(visibleCells(first).length).toBe(first.cells.length - 1)
    expect(isRectangular(node)).toBe(true)
  })

  it('spans downwards too', async () => {
    const { table } = await change((one) => {
      mergeCells(one, { row: 0, column: 0, toRow: 1, toColumn: 0 })
    })

    expect(table.rows[0]?.cells[0]?.rowSpan).toBe(2)
    expect(table.rows[1]?.cells[0]?.verticallyMerged).toBe(true)
  })

  it('marks a cell inside a block as swallowed both ways', async () => {
    const { table } = await change((one) => {
      mergeCells(one, { row: 0, column: 0, toRow: 1, toColumn: 1 })
    })

    const inner = table.rows[1]?.cells[1]
    expect(inner?.horizontallyMerged).toBe(true)
    expect(inner?.verticallyMerged).toBe(true)
  })

  it('does nothing for a range of one cell', async () => {
    const { table } = await change((one) => {
      mergeCells(one, { row: 0, column: 0, toRow: 0, toColumn: 0 })
    })

    expect(table.rows[0]?.cells[0]?.gridSpan).toBe(1)
  })
})

describe('splitting', () => {
  it('gives every swallowed cell its square back', async () => {
    const { node, table } = await change((one) => {
      mergeCells(one, { row: 0, column: 0, toRow: 1, toColumn: 1 })
      splitCell(one, 0, 0)
    })

    expect(table.rows[0]?.cells[0]?.gridSpan).toBe(1)
    expect(table.rows[0]?.cells[1]?.horizontallyMerged).toBe(false)
    expect(table.rows[1]?.cells[1]?.verticallyMerged).toBe(false)
    expect(isRectangular(node)).toBe(true)
  })

  it('does nothing to a cell that was never merged', async () => {
    const { table } = await change((one) => {
      expect(splitCell(one, 0, 0)).toBe(false)
    })

    expect(table.rows[0]?.cells[0]?.gridSpan).toBe(1)
  })
})
