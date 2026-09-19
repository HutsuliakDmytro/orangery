import { describe, expect, it } from 'vitest'
import {
  cellAtPoint,
  columnAtOffset,
  offsetOfColumn,
  rectangleOfCell,
  scrollToCell,
  totalHeight,
  totalWidth,
  visibleColumns,
  visibleRows,
} from './layout'
import type { GridMetrics, Viewport } from './layout'

const METRICS: GridMetrics = { rowHeight: 20, columnWidth: 100, headerWidth: 40, headerHeight: 20 }
const VIEW: Viewport = { scrollX: 0, scrollY: 0, width: 340, height: 220 }

describe('columns of equal width', () => {
  it('starts each one where the last ended', () => {
    expect(offsetOfColumn(METRICS, 0)).toBe(0)
    expect(offsetOfColumn(METRICS, 3)).toBe(300)
  })

  it('finds the column a distance falls in', () => {
    expect(columnAtOffset(METRICS, 0, 5)).toBe(0)
    expect(columnAtOffset(METRICS, 99, 5)).toBe(0)
    expect(columnAtOffset(METRICS, 100, 5)).toBe(1)
  })

  it('stops at the last column rather than running past it', () => {
    expect(columnAtOffset(METRICS, 10_000, 3)).toBe(2)
  })
})

describe('columns of their own widths', () => {
  const widths: GridMetrics = { ...METRICS, columnWidths: [60, 200, 40] }

  it('adds up the ones before it', () => {
    expect(offsetOfColumn(widths, 2)).toBe(260)
  })

  it('finds the column a distance falls in', () => {
    expect(columnAtOffset(widths, 59, 3)).toBe(0)
    expect(columnAtOffset(widths, 60, 3)).toBe(1)
    expect(columnAtOffset(widths, 259, 3)).toBe(1)
    expect(columnAtOffset(widths, 260, 3)).toBe(2)
  })

  it('falls back to the default width past the ones it was given', () => {
    expect(offsetOfColumn(widths, 4)).toBe(300 + 100)
  })
})

describe('what a window shows', () => {
  it('covers the rows across the viewport', () => {
    // Ten rows of twenty in two hundred points of grid.
    expect(visibleRows(METRICS, VIEW, 100)).toEqual({ first: 0, last: 10 })
  })

  it('keeps the row half-scrolled off the top', () => {
    // Leaving it out draws a blank stripe along the edge.
    const scrolled = visibleRows(METRICS, { ...VIEW, scrollY: 30 }, 100)
    expect(scrolled.first).toBe(1)
  })

  it('never names a row the data does not have', () => {
    expect(visibleRows(METRICS, VIEW, 3).last).toBe(2)
    expect(visibleColumns(METRICS, VIEW, 2).last).toBe(1)
  })

  it('counts the whole grid, headers included', () => {
    expect(totalWidth(METRICS, 4)).toBe(440)
    expect(totalHeight(METRICS, 5)).toBe(120)
  })
})

describe('where a cell is drawn', () => {
  it('sits past the headers', () => {
    expect(rectangleOfCell(METRICS, VIEW, { row: 0, column: 0 })).toEqual({
      x: 40,
      y: 20,
      width: 100,
      height: 20,
    })
  })

  it('moves with the scroll', () => {
    const rect = rectangleOfCell(
      METRICS,
      { ...VIEW, scrollY: 40, scrollX: 100 },
      { row: 2, column: 1 },
    )
    expect(rect).toEqual({ x: 40, y: 20, width: 100, height: 20 })
  })
})

describe('what is under the pointer', () => {
  it('is the cell it looks like', () => {
    expect(cellAtPoint(METRICS, VIEW, { x: 45, y: 25 }, { rows: 5, columns: 3 })).toEqual({
      row: 0,
      column: 0,
    })
    expect(cellAtPoint(METRICS, VIEW, { x: 145, y: 65 }, { rows: 5, columns: 3 })).toEqual({
      row: 2,
      column: 1,
    })
  })

  it('is nothing over a header, which is a different gesture', () => {
    // Returning A1 would select it whenever somebody reached for the letter
    // above it.
    expect(cellAtPoint(METRICS, VIEW, { x: 10, y: 60 }, { rows: 5, columns: 3 })).toBeNull()
    expect(cellAtPoint(METRICS, VIEW, { x: 100, y: 10 }, { rows: 5, columns: 3 })).toBeNull()
  })

  it('is nothing past the last row', () => {
    expect(cellAtPoint(METRICS, VIEW, { x: 45, y: 200 }, { rows: 2, columns: 3 })).toBeNull()
  })
})

describe('scrolling to a cell', () => {
  it('leaves the window alone when the cell is already in it', () => {
    expect(scrollToCell(METRICS, VIEW, { row: 2, column: 1 })).toEqual({ scrollX: 0, scrollY: 0 })
  })

  it('moves by as little as it can', () => {
    // Arrowing down past the last visible row scrolls by one row, not by a
    // screenful that loses the reader's place.
    const to = scrollToCell(METRICS, VIEW, { row: 10, column: 0 })
    expect(to.scrollY).toBe(20)
  })

  it('brings a cell above the window back into it', () => {
    const to = scrollToCell(METRICS, { ...VIEW, scrollY: 200 }, { row: 3, column: 0 })
    expect(to.scrollY).toBe(60)
  })
})
