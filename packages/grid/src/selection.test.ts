import { describe, expect, it } from 'vitest'
import {
  boundsOf,
  coversCell,
  coversColumn,
  coversRow,
  edgeFrom,
  everything,
  extendedTo,
  selectedCount,
  singleCell,
  stepFrom,
  wholeColumns,
  wholeRows,
  withRange,
} from './selection'

/**
 * What is selected, as arithmetic.
 *
 * All of it testable without a canvas, and all of it the difference between a
 * grid that does what a person expects and one that nearly does: which corner
 * `Shift` keeps still, where `Mod` and an arrow land, whether clicking the
 * same cell twice counts it twice.
 */

describe('a range, whichever way it was made', () => {
  it('has the same bounds dragged up as dragged down', () => {
    const down = { anchor: { row: 1, column: 1 }, focus: { row: 4, column: 3 } }
    const up = { anchor: { row: 4, column: 3 }, focus: { row: 1, column: 1 } }

    expect(boundsOf(down)).toEqual(boundsOf(up))
  })
})

describe('extending a selection', () => {
  it('keeps the corner it was started from, which is the point of Shift', () => {
    const from = singleCell({ row: 2, column: 2 })
    const wider = extendedTo(from, { row: 5, column: 5 })

    expect(boundsOf(wider.ranges[0] ?? { anchor: wider.active, focus: wider.active })).toEqual({
      top: 2,
      left: 2,
      bottom: 5,
      right: 5,
    })
  })

  it('leaves the cursor where it was', () => {
    // Shift-clicking picks a range. It does not move the cell a typed value
    // would land in, and a grid that moved it would put the value at the far
    // end of what somebody had just selected.
    const wider = extendedTo(singleCell({ row: 2, column: 2 }), { row: 5, column: 5 })
    expect(wider.active).toEqual({ row: 2, column: 2 })
  })

  it('extends the last range when there are several', () => {
    const two = withRange(singleCell({ row: 0, column: 0 }), {
      anchor: { row: 3, column: 3 },
      focus: { row: 3, column: 3 },
    })

    const wider = extendedTo(two, { row: 6, column: 3 })

    const second = wider.ranges[1]
    if (second === undefined) throw new Error('the second range went missing')

    expect(wider.ranges).toHaveLength(2)
    expect(boundsOf(second)).toMatchObject({ top: 3, bottom: 6 })
    expect(coversCell(wider, { row: 0, column: 0 })).toBe(true)
  })
})

describe('what a selection covers', () => {
  const selection = withRange(singleCell({ row: 0, column: 0 }), wholeRows(2, 3, 10))

  it('says yes inside any of its ranges', () => {
    expect(coversCell(selection, { row: 0, column: 0 })).toBe(true)
    expect(coversCell(selection, { row: 3, column: 7 })).toBe(true)
    expect(coversCell(selection, { row: 5, column: 0 })).toBe(false)
  })

  it('knows a whole row from a range that merely touches one', () => {
    expect(coversRow(selection, 2, 10)).toBe(true)
    expect(coversRow(selection, 0, 10)).toBe(false)
  })

  it('knows a whole column the same way', () => {
    const columns = { ranges: [wholeColumns(1, 2, 10)], active: { row: 0, column: 1 } }

    expect(coversColumn(columns, 1, 10)).toBe(true)
    expect(coversColumn(columns, 3, 10)).toBe(false)
  })
})

describe('counting what is selected', () => {
  it('counts a rectangle by its sides', () => {
    expect(
      selectedCount(extendedTo(singleCell({ row: 1, column: 1 }), { row: 3, column: 4 })),
    ).toBe(12)
  })

  it('counts a cell in two ranges once', () => {
    // Which is what Mod-clicking a cell that is already selected makes; a
    // count that said two would be a count of clicks.
    const twice = withRange(singleCell({ row: 1, column: 1 }), {
      anchor: { row: 1, column: 1 },
      focus: { row: 1, column: 1 },
    })

    expect(selectedCount(twice)).toBe(1)
  })

  it('counts everything as everything', () => {
    expect(selectedCount(everything(4, 5))).toBe(20)
  })
})

describe('one step along', () => {
  const counts = { rows: 10, columns: 10 }

  it('goes where it is told', () => {
    expect(stepFrom({ row: 2, column: 2 }, 'down', counts)).toEqual({ row: 3, column: 2 })
    expect(stepFrom({ row: 2, column: 2 }, 'left', counts)).toEqual({ row: 2, column: 1 })
  })

  it('stops at the edge rather than walking off it', () => {
    expect(stepFrom({ row: 0, column: 0 }, 'up', counts)).toEqual({ row: 0, column: 0 })
    expect(stepFrom({ row: 9, column: 9 }, 'right', counts)).toEqual({ row: 9, column: 9 })
  })
})

describe('Mod and an arrow', () => {
  const counts = { rows: 20, columns: 5 }
  // A column of figures in rows 0 to 3, a gap, and one more at row 8.
  const filled = (cell: { row: number; column: number }) =>
    cell.column === 0 && (cell.row <= 3 || cell.row === 8)

  it('goes to the end of the run it is in', () => {
    expect(edgeFrom({ row: 0, column: 0 }, 'down', counts, filled)).toEqual({ row: 3, column: 0 })
  })

  it('crosses a gap to the next thing there is', () => {
    expect(edgeFrom({ row: 3, column: 0 }, 'down', counts, filled)).toEqual({ row: 8, column: 0 })
  })

  it('goes to the far edge when there is nothing left to find', () => {
    // The alternative is stopping in the middle of an empty sheet, which is
    // not what anybody pressing this is asking for.
    expect(edgeFrom({ row: 8, column: 0 }, 'down', counts, filled)).toEqual({ row: 19, column: 0 })
  })

  it('stays put at the edge it is already on', () => {
    expect(edgeFrom({ row: 0, column: 0 }, 'up', counts, filled)).toEqual({ row: 0, column: 0 })
  })
})
