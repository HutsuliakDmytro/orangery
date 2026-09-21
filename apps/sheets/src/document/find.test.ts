import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { cellAt } from '@orangery/ooxml-spreadsheet'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { applyEdit } from './edit'
import { findAll, nextAfter, replaceAll, replaceIn } from './find'
import type { SearchOptions } from './find'

/**
 * Finding something, and putting something else in its place.
 *
 * The cases that matter are the two things a cell can be asked for: what it
 * shows and what it holds. A date shows `01-01-24` and holds 45292, and a
 * search that could only answer one of those would be wrong for half the
 * people who use it.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let open: OpenWorkbook
let sheet: OpenSheet

beforeEach(async () => {
  open = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
  const first = open.sheets[0]
  if (first === undefined) throw new Error('the fixture has no sheets')
  sheet = first
})

const VALUES: SearchOptions = {
  within: 'values',
  matchCase: false,
  wholeCell: false,
  everywhere: false,
}

const at = (row: number, column: number) => cellAt(sheet.cells, { row, column })

describe('what a search looks at', () => {
  it('finds a word a cell shows', () => {
    expect(findAll(open, [sheet], 'January', VALUES)).toEqual([
      { sheet: sheet.path, row: 1, column: 0 },
    ])
  })

  it('finds a date by what it shows, not by the number it holds', () => {
    // C2 holds 45292 and shows 01-01-24.
    expect(findAll(open, [sheet], '01-01-24', VALUES)).toHaveLength(1)
    expect(findAll(open, [sheet], '45292', VALUES)).toHaveLength(0)
  })

  it('finds a reference inside a formula when asked to look there', () => {
    const found = findAll(open, [sheet], 'B2', { ...VALUES, within: 'formulas' })
    expect(found).toEqual([{ sheet: sheet.path, row: 3, column: 2 }])
  })

  it('ignores case unless told not to', () => {
    expect(findAll(open, [sheet], 'january', VALUES)).toHaveLength(1)
    expect(findAll(open, [sheet], 'january', { ...VALUES, matchCase: true })).toHaveLength(0)
  })

  it('can be asked for the whole cell rather than a part of it', () => {
    expect(findAll(open, [sheet], 'Jan', VALUES)).toHaveLength(1)
    expect(findAll(open, [sheet], 'Jan', { ...VALUES, wholeCell: true })).toHaveLength(0)
  })

  it('walks the sheet the way a person reads it', () => {
    applyEdit(open, sheet, { row: 12, column: 1 }, 'here')
    applyEdit(open, sheet, { row: 11, column: 5 }, 'here')

    const found = findAll(open, [sheet], 'here', VALUES)
    expect(found.map((one) => one.row)).toEqual([11, 12])
  })

  it('finds nothing for nothing', () => {
    expect(findAll(open, [sheet], '', VALUES)).toEqual([])
  })

  it('looks at every sheet when it is asked to', () => {
    const found = findAll(open, open.sheets, 'January', VALUES)
    expect(found.length).toBeGreaterThanOrEqual(1)
  })
})

describe('walking the matches', () => {
  it('starts at the first when nothing is selected', () => {
    const found = findAll(open, [sheet], 'a', VALUES)
    expect(nextAfter(found, null)).toEqual(found[0])
  })

  it('goes round the end rather than stopping at it', () => {
    const found = findAll(open, [sheet], 'a', VALUES)
    const last = found[found.length - 1]
    if (last === undefined) throw new Error('nothing was found')

    expect(nextAfter(found, last)).toEqual(found[0])
  })

  it('goes backwards as readily as forwards', () => {
    const found = findAll(open, [sheet], 'a', VALUES)
    expect(nextAfter(found, found[0] ?? null, true)).toEqual(found[found.length - 1])
  })

  it('finds the next one after a cell that is not itself a match', () => {
    const found = findAll(open, [sheet], 'January', VALUES)
    const next = nextAfter(found, { sheet: sheet.path, row: 0, column: 0 })

    expect(next).toEqual(found[0])
  })
})

describe('putting something else in its place', () => {
  it('leaves the rest of the cell alone', () => {
    applyEdit(open, sheet, { row: 10, column: 0 }, 'north and south')
    replaceIn(open, sheet, { row: 10, column: 0 }, 'north', 'west', VALUES)

    expect(at(10, 0)?.value).toBe('west and south')
  })

  it('replaces every occurrence in the cell', () => {
    applyEdit(open, sheet, { row: 10, column: 0 }, 'a and a and a')
    replaceIn(open, sheet, { row: 10, column: 0 }, 'a and', 'b or', VALUES)

    expect(at(10, 0)?.value).toBe('b or b or a')
  })

  it('reads what it wrote the way typing would', () => {
    // The whole cell becoming `5` makes a number, not the word for one.
    applyEdit(open, sheet, { row: 10, column: 0 }, 'four')
    replaceIn(open, sheet, { row: 10, column: 0 }, 'four', '5', { ...VALUES, wholeCell: true })

    expect(at(10, 0)?.type).toBe('n')
    expect(at(10, 0)?.value).toBe('5')
  })

  it('changes a formula’s text and leaves it a formula', () => {
    // Writing the new formula in as a value would turn a sum into a word.
    replaceIn(open, sheet, { row: 3, column: 2 }, 'B2', 'B5', { ...VALUES, within: 'formulas' })

    expect(at(3, 2)?.formula?.text).toBe('B5+B3')
    expect(at(3, 2)?.value).not.toBeNull()
  })

  it('does nothing to a cell that does not match', () => {
    expect(replaceIn(open, sheet, { row: 1, column: 0 }, 'nothing', 'x', VALUES)).toBeNull()
  })
})

describe('replacing all of them', () => {
  it('is one list of changes, so it is one thing to take back', () => {
    applyEdit(open, sheet, { row: 10, column: 0 }, 'north')
    applyEdit(open, sheet, { row: 11, column: 0 }, 'north')

    const changes = replaceAll(open, [sheet], 'north', 'west', VALUES)

    expect(changes).toHaveLength(2)
    expect(at(10, 0)?.value).toBe('west')
    expect(at(11, 0)?.value).toBe('west')
  })

  it('reaches every sheet it was given', () => {
    const changes = replaceAll(open, open.sheets, 'January', 'Jan', VALUES)
    expect(changes.length).toBeGreaterThanOrEqual(1)
  })
})
