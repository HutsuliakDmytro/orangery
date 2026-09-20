import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { cellAt } from '@orangery/ooxml-spreadsheet'
import { singleCell } from '@orangery/grid'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { reshape } from './structure'
import { emptyHistory, recorded, undo } from './history'

/**
 * Putting rows and columns in, and taking them out.
 *
 * Two things happen and only one of them is obvious. The cells below an
 * insertion move down; and every formula on the sheet, wherever it is, may be
 * pointing at a cell that has just moved. The second is what the tests here
 * are mostly about, because it is the half that is silently wrong when it is
 * wrong.
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

const at = (row: number, column: number) => cellAt(sheet.cells, { row, column })

describe('putting rows in', () => {
  it('moves what was below down, and leaves what was above', () => {
    // A1 is the header; A2 held January.
    expect(at(1, 0)?.value).toBe('2')
    reshape(sheet, { axis: 'row', at: 1, by: 1 })

    expect(at(1, 0)).toBeNull()
    expect(at(2, 0)?.value).toBe('2')
    expect(at(0, 0)?.value).toBe('0')
  })

  it('rewrites a formula that was pointing at what moved', () => {
    // C4 holds `B2+B3`. Put a row in above them and it has to mean B3+B4.
    reshape(sheet, { axis: 'row', at: 1, by: 1 })

    expect(at(4, 2)?.formula?.text).toBe('B3+B4')
  })

  it('puts in as many as it is asked for', () => {
    reshape(sheet, { axis: 'row', at: 1, by: 3 })
    expect(at(4, 0)?.value).toBe('2')
  })

  it('carries a row’s height down with the row', () => {
    // Row 2 of the fixture is thirty points tall.
    expect(sheet.cells.properties.get(1)?.height).toBe(30)
    reshape(sheet, { axis: 'row', at: 0, by: 1 })

    expect(sheet.cells.properties.get(2)?.height).toBe(30)
  })
})

describe('taking rows out', () => {
  it('pulls what was below up over them', () => {
    reshape(sheet, { axis: 'row', at: 1, by: -1 })

    // What was A3 is A2 now.
    expect(at(1, 0)?.value).toBe('3')
  })

  it('says #REF! where a formula pointed at what was removed', () => {
    // C4 holds `B2+B3`; take row 2 away and half of it is gone.
    reshape(sheet, { axis: 'row', at: 1, by: -1 })

    expect(at(2, 2)?.formula?.text).toBe('#REF!+B2')
  })

  it('takes the cells of the removed rows with them', () => {
    const before = at(1, 1)?.value
    reshape(sheet, { axis: 'row', at: 1, by: -1 })

    expect(at(1, 1)?.value).not.toBe(before)
  })
})

describe('columns', () => {
  it('move across the same way rows move down', () => {
    expect(at(1, 1)?.value).toBe('1234.5')
    reshape(sheet, { axis: 'column', at: 1, by: 1 })

    expect(at(1, 1)).toBeNull()
    expect(at(1, 2)?.value).toBe('1234.5')
  })

  it('rewrite the formulas that pointed across them', () => {
    reshape(sheet, { axis: 'column', at: 0, by: 1 })
    expect(at(3, 3)?.formula?.text).toBe('C2+C3')
  })
})

describe('taking it back', () => {
  it('puts every cell where it was, formulas included', () => {
    const before = { header: at(0, 0), figure: at(1, 1), formula: at(3, 2) }

    const history = recorded(emptyHistory(), {
      changes: reshape(sheet, { axis: 'row', at: 1, by: 2 }),
      selection: singleCell({ row: 1, column: 0 }),
    })
    undo(open, history)

    expect(at(0, 0)).toEqual(before.header)
    expect(at(1, 1)).toEqual(before.figure)
    expect(at(3, 2)).toEqual(before.formula)
  })

  it('does the same for a deletion', () => {
    const before = at(1, 1)

    const history = recorded(emptyHistory(), {
      changes: reshape(sheet, { axis: 'row', at: 1, by: -1 }),
      selection: singleCell({ row: 1, column: 0 }),
    })
    undo(open, history)

    expect(at(1, 1)).toEqual(before)
  })
})

describe('a change that changes nothing', () => {
  it('is not a change', () => {
    expect(reshape(sheet, { axis: 'row', at: 0, by: 0 })).toEqual([])
  })
})
