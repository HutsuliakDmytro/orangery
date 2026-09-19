import { describe, expect, it } from 'vitest'
import {
  cellAtPoint,
  columnAtOffset,
  frozenSize,
  offsetOfColumn,
  offsetOfRow,
  rectangleOfCell,
  rowAtOffset,
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

describe('rows of their own heights', () => {
  const tall: GridMetrics = { ...METRICS, rowHeights: [40, 20, 60] }

  it('adds up the ones above it', () => {
    expect(offsetOfRow(tall, 0)).toBe(0)
    expect(offsetOfRow(tall, 2)).toBe(60)
    expect(offsetOfRow(tall, 3)).toBe(120)
  })

  it('finds the row a distance falls in', () => {
    expect(rowAtOffset(tall, 39, 5)).toBe(0)
    expect(rowAtOffset(tall, 40, 5)).toBe(1)
    expect(rowAtOffset(tall, 119, 5)).toBe(2)
  })

  it('falls back to the default height past the ones it was given', () => {
    expect(offsetOfRow(tall, 4)).toBe(140)
  })

  it('counts the whole grid with the heights it was given', () => {
    expect(totalHeight(tall, 3)).toBe(METRICS.headerHeight + 120)
  })
})

describe('rows and columns held still', () => {
  const frozen = { rows: 2, columns: 1 }

  it('takes up the room its rows and columns take', () => {
    expect(frozenSize(METRICS, frozen)).toEqual({ width: 100, height: 40 })
    expect(frozenSize(METRICS, null)).toEqual({ width: 0, height: 0 })
  })

  it('stays where it is while the rest scrolls', () => {
    const scrolled: Viewport = { ...VIEW, scrollY: 200, scrollX: 300 }

    // The first two rows are always the first two on screen.
    expect(rectangleOfCell(METRICS, scrolled, { row: 0, column: 0 }, frozen)).toMatchObject({
      x: 40,
      y: 20,
    })
    // And the rest has moved.
    expect(rectangleOfCell(METRICS, scrolled, { row: 20, column: 4 }, frozen).y).toBe(
      20 + 20 * 20 - 200,
    )
  })

  it('starts the scrolling region after the frozen one', () => {
    const rows = visibleRows(METRICS, { ...VIEW, scrollY: 0 }, 100, frozen)
    expect(rows.first).toBe(2)

    const columns = visibleColumns(METRICS, VIEW, 10, frozen)
    expect(columns.first).toBe(1)
  })

  it('finds a frozen cell under the pointer wherever the sheet has scrolled', () => {
    const scrolled: Viewport = { ...VIEW, scrollY: 400 }

    // A click in the top strip is the frozen row, not the row the scroll
    // would put there.
    expect(
      cellAtPoint(METRICS, scrolled, { x: 45, y: 25 }, { rows: 100, columns: 5 }, frozen),
    ).toEqual({ row: 0, column: 0 })
  })

  it('finds the scrolled cell past the strip', () => {
    const scrolled: Viewport = { ...VIEW, scrollY: 400 }
    const cell = cellAtPoint(
      METRICS,
      scrolled,
      { x: 45, y: 100 },
      { rows: 100, columns: 5 },
      frozen,
    )

    // The scrolling region starts at the scroll plus the frozen strip — 440,
    // which is row 22 — and it is drawn just below that strip. Forty points
    // further down is two rows on.
    expect(cell).toEqual({ row: 24, column: 0 })
  })
})
