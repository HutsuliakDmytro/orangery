import { describe, expect, it } from 'vitest'
import { movedIndex, movedPosition, movedRange, movedRanges } from './band'
import { formatReference, parseRange } from './reference'
import type { BandChange } from './formulas'

/**
 * Rectangles, after rows or columns moved under them.
 *
 * The expectations here are Excel's: a merge, a conditional rule and a table
 * were put on a sheet, a row was inserted at each interesting place, and what
 * the file said afterwards is what is written down.
 */

const range = (text: string) => {
  const parsed = parseRange(text)
  if (parsed === null) throw new Error(`${text} is not a range`)
  return parsed
}

/** The range back as text, so a test reads the way a person would say it. */
const shown = (text: string, change: BandChange): string | null => {
  const after = movedRange(range(text), change)
  if (after === null) return null

  return `${formatReference(after.from)}:${formatReference(after.to)}`
}

const insertRows = (at: number, by = 1): BandChange => ({ axis: 'row', at, by })
const deleteRows = (at: number, by = 1): BandChange => ({ axis: 'row', at, by: -by })

describe('a rectangle and an insertion', () => {
  it('moves down when the row goes in above it', () => {
    // B5:D7 with a row inserted at row 1.
    expect(shown('B5:D7', insertRows(0))).toBe('B6:D8')
  })

  it('stays put when the row goes in below it', () => {
    expect(shown('B5:D7', insertRows(7))).toBe('B5:D7')
  })

  it('grows when the row goes in inside it', () => {
    // The rows it covered are still the rows it covers, and there is now one
    // more between them.
    expect(shown('B5:D7', insertRows(5))).toBe('B5:D8')
  })

  it('grows when the row goes in at its last row', () => {
    // Inserting at row 7 puts the new row before the old one, so the old
    // bottom edge moves and the range reaches it.
    expect(shown('B5:D7', insertRows(6))).toBe('B5:D8')
  })

  it('moves when the row goes in at its first row', () => {
    expect(shown('B5:D7', insertRows(4))).toBe('B6:D8')
  })

  it('is untouched by a change on the other axis', () => {
    expect(shown('B5:D7', { axis: 'column', at: 0, by: 1 })).toBe('C5:E7')
  })
})

describe('a rectangle and a deletion', () => {
  it('moves up when the rows above it go', () => {
    expect(shown('B5:D7', deleteRows(0, 2))).toBe('B3:D5')
  })

  it('shrinks when rows inside it go', () => {
    expect(shown('B5:D9', deleteRows(5, 2))).toBe('B5:D7')
  })

  it('keeps the rows it still has when the band overlaps its top', () => {
    // Rows 3 and 4 went; row 5 moved up into row 3, and the range starts there.
    expect(shown('B5:D9', deleteRows(2, 3))).toBe('B3:D6')
  })

  it('is gone when every row of it goes', () => {
    expect(shown('B5:D7', deleteRows(4, 3))).toBeNull()
  })

  it('is gone when a wider band swallows it', () => {
    expect(shown('B5:D7', deleteRows(0, 100))).toBeNull()
  })

  it('is untouched when the band is entirely below it', () => {
    expect(shown('B5:D7', deleteRows(7, 3))).toBe('B5:D7')
  })
})

describe('the edges of the sheet', () => {
  it('cannot push a whole-column range past the bottom', () => {
    // How `A:A` is stored, and how Excel writes a whole-column rule: it
    // already reaches the last row, so an insertion cannot make it taller.
    const whole = { sheet: null, from: { row: 0, column: 0 }, to: { row: 1_048_575, column: 0 } }
    const after = movedRange(whole, insertRows(0, 5))

    expect(after?.to.row).toBe(1_048_575)
    expect(after?.from.row).toBe(5)
  })

  it('drops a range pushed off the end entirely', () => {
    const last = {
      sheet: null,
      from: { row: 1_048_575, column: 0 },
      to: { row: 1_048_575, column: 0 },
    }

    expect(movedRange(last, insertRows(0))).toBeNull()
  })

  it('keeps the sheet a range names', () => {
    const after = movedRange({ ...range('B5:D7'), sheet: 'Sales' }, insertRows(0))

    expect(after?.sheet).toBe('Sales')
  })
})

describe('a single line', () => {
  it('moves down past an insertion', () => {
    expect(movedIndex(5, insertRows(2, 3))).toBe(8)
  })

  it('stays above one', () => {
    expect(movedIndex(1, insertRows(2, 3))).toBe(1)
  })

  it('is gone when its own line goes', () => {
    expect(movedIndex(3, deleteRows(2, 3))).toBeNull()
  })

  it('moves up past a deletion below it', () => {
    expect(movedIndex(9, deleteRows(2, 3))).toBe(6)
  })
})

describe('a single cell', () => {
  it('moves on the axis that changed and not the other', () => {
    expect(movedPosition({ row: 4, column: 2 }, insertRows(0, 2))).toEqual({ row: 6, column: 2 })
    expect(movedPosition({ row: 4, column: 2 }, { axis: 'column', at: 0, by: 2 })).toEqual({
      row: 4,
      column: 4,
    })
  })

  it('is gone when its row goes', () => {
    expect(movedPosition({ row: 4, column: 2 }, deleteRows(4))).toBeNull()
  })
})

describe('a list of rectangles', () => {
  it('drops the ones that did not survive and keeps the order', () => {
    const after = movedRanges([range('A1:A2'), range('A5:A6'), range('A9:A10')], deleteRows(4, 2))

    expect(after.map((one) => formatReference(one.from))).toEqual(['A1', 'A7'])
  })

  it('gives back what it was given when nothing changed', () => {
    const ranges = [range('A1:A2')]

    expect(movedRanges(ranges, { axis: 'row', at: 0, by: 0 })).toEqual(ranges)
  })
})
