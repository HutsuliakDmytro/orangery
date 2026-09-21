import { describe, expect, it } from 'vitest'
import {
  cellsOfRange,
  columnToIndex,
  extendedRange,
  formatReference,
  indexToColumn,
  parseRange,
  parseReference,
} from './reference'

describe('columns', () => {
  it('counts from A, with no zero digit', () => {
    // Bijective base 26: after Z comes AA, not BA — the arithmetic that gets
    // this wrong is off by one only past the twenty-sixth column, where
    // nobody looks.
    expect(columnToIndex('A')).toBe(0)
    expect(columnToIndex('Z')).toBe(25)
    expect(columnToIndex('AA')).toBe(26)
    expect(columnToIndex('XFD')).toBe(16383)
  })

  it('writes them back the way it read them', () => {
    for (const index of [0, 25, 26, 51, 701, 702, 16383]) {
      expect(columnToIndex(indexToColumn(index))).toBe(index)
    }
  })

  it('refuses what is not a column', () => {
    expect(columnToIndex('')).toBeNull()
    expect(columnToIndex('A1')).toBeNull()
    expect(columnToIndex('a')).toBeNull()
  })
})

describe('references', () => {
  it('reads a cell as a position counted from zero', () => {
    expect(parseReference('A1')).toEqual({ row: 0, column: 0 })
    expect(parseReference('C5')).toEqual({ row: 4, column: 2 })
  })

  it('reads the dollars a chart writes as the same cell', () => {
    expect(parseReference('$B$2')).toEqual(parseReference('B2'))
  })

  it('writes a position as the file names it', () => {
    expect(formatReference({ row: 4, column: 2 })).toBe('C5')
  })

  it('refuses a row of zero, which no sheet has', () => {
    expect(parseReference('A0')).toBeNull()
    expect(parseReference('1A')).toBeNull()
  })
})

describe('ranges', () => {
  it('reads the sheet and both ends', () => {
    expect(parseRange('Sheet1!$B$2:$B$5')).toEqual({
      sheet: 'Sheet1',
      from: { row: 1, column: 1 },
      to: { row: 4, column: 1 },
    })
  })

  it('reads a sheet whose name has a space in it', () => {
    expect(parseRange("'My sheet'!A1")?.sheet).toBe('My sheet')
  })

  it('reads a single cell as a range of one, which is how a title is named', () => {
    const range = parseRange('Sheet1!$B$1')
    expect(range?.from).toEqual(range?.to)
  })

  it('lists the cells of a column and of a block', () => {
    expect(
      cellsOfRange({ sheet: null, from: { row: 1, column: 1 }, to: { row: 3, column: 1 } }),
    ).toEqual(['B2', 'B3', 'B4'])
    expect(
      cellsOfRange({ sheet: null, from: { row: 0, column: 0 }, to: { row: 1, column: 1 } }),
    ).toEqual(['A1', 'B1', 'A2', 'B2'])
  })

  it('moves the last row of a range, keeping the dollars it had', () => {
    expect(extendedRange('Sheet1!$B$2:$B$5', 1)).toBe('Sheet1!$B$2:$B$6')
    expect(extendedRange('Sheet1!B2:B5', -1)).toBe('Sheet1!B2:B4')
  })

  it('refuses to move a range past its own start', () => {
    // A chart with no points is not a chart anybody meant to make.
    expect(extendedRange('Sheet1!$B$2:$B$2', -1)).toBeNull()
    expect(extendedRange('Sheet1!$B$1', 1)).toBeNull()
  })
})
