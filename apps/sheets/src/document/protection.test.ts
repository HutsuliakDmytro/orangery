import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { isLocked, refusalForLocked } from './protection'

/**
 * Whether a cell may be changed.
 *
 * The rule that surprises people: every cell is locked unless its style says
 * otherwise, which is why protecting a sheet locks everything rather than
 * nothing — and why a sheet nobody protected has no locked cells at all,
 * however many of them say they are.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let open: OpenWorkbook
let sheet: OpenSheet

const protect = (allowed: Partial<OpenSheet['sheet']['protection']> = {}) => {
  sheet.sheet.protection = {
    cells: true,
    selectLocked: true,
    selectUnlocked: true,
    formatCells: false,
    insertRows: false,
    insertColumns: false,
    deleteRows: false,
    deleteColumns: false,
    sort: false,
    autoFilter: false,
    ...allowed,
  }
}

beforeEach(async () => {
  open = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
  const first = open.sheets[0]
  if (first === undefined) throw new Error('the fixture has no sheets')
  sheet = first
})

describe('a sheet nobody protected', () => {
  it('has no locked cells, whatever their styles say', () => {
    expect(isLocked(open, sheet, { row: 0, column: 0 })).toBe(false)
    expect(refusalForLocked(open, sheet, [{ row: 0, column: 0 }])).toBeNull()
  })
})

describe('a sheet somebody protected', () => {
  it('locks every cell that did not say it was unlocked', () => {
    protect()
    expect(isLocked(open, sheet, { row: 0, column: 0 })).toBe(true)
    expect(isLocked(open, sheet, { row: 500, column: 500 })).toBe(true)
  })

  it('says what to tell whoever tried', () => {
    protect()
    expect(refusalForLocked(open, sheet, [{ row: 0, column: 0 }])).toContain('protected')
  })

  it('says nothing when the cells being changed are all unlocked', () => {
    // Which is how a form works: a protected sheet with a few cells left
    // open is the one arrangement everybody uses this for.
    protect()
    const styles = open.styles
    if (styles === null) throw new Error('the fixture has no styles')

    const first = styles.cellFormats[0]
    if (first === undefined) throw new Error('the fixture has no cell formats')

    const unlocked = styles.cellFormats.length
    styles.cellFormats.push({ ...first, locked: false })
    sheet.cells.rows.get(0)?.set(0, {
      row: 0,
      column: 0,
      type: 'n',
      value: '1',
      style: unlocked,
      formula: null,
      rich: null,
      carried: null,
    })

    expect(isLocked(open, sheet, { row: 0, column: 0 })).toBe(false)
  })
})
