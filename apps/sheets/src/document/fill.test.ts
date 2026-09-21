import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { cellAt } from '@orangery/ooxml-spreadsheet'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { applyEdit } from './edit'
import { fillCells } from './fill'

/**
 * Dragging the corner of a selection.
 *
 * What a person would notice: 1, 2 goes on 3, 4; a formula carries on
 * referring to the row it is in; a date stays a date rather than becoming the
 * number a date is stored as; and a drag upwards counts backwards.
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

/** A couple of cells well clear of the fixture's own, ready to drag. */
const typed = (values: string[], row = 10, column = 0) => {
  for (const [offset, value] of values.entries()) {
    applyEdit(open, sheet, { row: row + offset, column }, value)
  }

  return { top: row, bottom: row + values.length - 1, left: column, right: column }
}

describe('what a drag writes', () => {
  it('counts a series on', () => {
    const from = typed(['1', '2'])
    fillCells(open, sheet, { from, to: { row: 14, column: 0 } })

    expect([at(12, 0)?.value, at(13, 0)?.value, at(14, 0)?.value]).toEqual(['3', '4', '5'])
  })

  it('repeats a value that is not a series', () => {
    const from = typed(['Total'])
    fillCells(open, sheet, { from, to: { row: 12, column: 0 } })

    expect(at(12, 0)?.value).toBe('Total')
  })

  it('goes on with the days of the week', () => {
    const from = typed(['Monday'])
    fillCells(open, sheet, { from, to: { row: 12, column: 0 } })

    expect([at(11, 0)?.value, at(12, 0)?.value]).toEqual(['Tuesday', 'Wednesday'])
  })

  it('counts backwards when dragged upwards', () => {
    const from = typed(['5', '6'], 10)
    fillCells(open, sheet, { from, to: { row: 8, column: 0 } })

    expect([at(9, 0)?.value, at(8, 0)?.value]).toEqual(['4', '3'])
  })

  it('fills across as readily as down', () => {
    applyEdit(open, sheet, { row: 10, column: 0 }, '1')
    applyEdit(open, sheet, { row: 10, column: 1 }, '2')

    fillCells(open, sheet, {
      from: { top: 10, bottom: 10, left: 0, right: 1 },
      to: { row: 10, column: 3 },
    })

    expect([at(10, 2)?.value, at(10, 3)?.value]).toEqual(['3', '4'])
  })

  it('fills each column of a block as its own series', () => {
    applyEdit(open, sheet, { row: 10, column: 0 }, '1')
    applyEdit(open, sheet, { row: 10, column: 1 }, 'Monday')

    fillCells(open, sheet, {
      from: { top: 10, bottom: 10, left: 0, right: 1 },
      to: { row: 11, column: 1 },
    })

    expect(at(11, 0)?.value).toBe('2')
    expect(at(11, 1)?.value).toBe('Tuesday')
  })

  it('says what it changed, so a drag is one thing to take back', () => {
    const from = typed(['1', '2'])
    const changes = fillCells(open, sheet, { from, to: { row: 13, column: 0 } })

    expect(changes).toHaveLength(2)
    expect(changes[0]).toMatchObject({ sheet: sheet.path, row: 12, column: 0 })
  })

  it('does nothing for a drag that went nowhere', () => {
    const from = typed(['1', '2'])
    expect(fillCells(open, sheet, { from, to: { row: 11, column: 0 } })).toEqual([])
  })
})

describe('what a drag carries with it', () => {
  it('moves a formula’s references by as far as the cell moved', () => {
    // C4 holds `B2+B3`; a row below it has to mean `B3+B4`.
    fillCells(open, sheet, {
      from: { top: 3, bottom: 3, left: 2, right: 2 },
      to: { row: 4, column: 2 },
    })

    expect(at(4, 2)?.formula?.text).toBe('B3+B4')
  })

  it('takes the look of the cell it came from', () => {
    // Otherwise a column of dates filled downwards becomes a column of the
    // numbers dates are stored as.
    applyEdit(open, sheet, { row: 10, column: 0 }, '2026-01-01')
    const style = at(10, 0)?.style

    fillCells(open, sheet, {
      from: { top: 10, bottom: 10, left: 0, right: 0 },
      to: { row: 11, column: 0 },
    })

    expect(at(11, 0)?.style).toBe(style)
  })

  it('carries a date on by a day', () => {
    applyEdit(open, sheet, { row: 10, column: 0 }, '2026-01-01')
    applyEdit(open, sheet, { row: 11, column: 0 }, '2026-01-02')

    fillCells(open, sheet, {
      from: { top: 10, bottom: 11, left: 0, right: 0 },
      to: { row: 12, column: 0 },
    })

    // The day after the second, as a serial number one larger.
    expect(Number(at(12, 0)?.value)).toBe(Number(at(11, 0)?.value) + 1)
  })
})
