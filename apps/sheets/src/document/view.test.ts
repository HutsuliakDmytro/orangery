import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { workbookBytes } from './save'
import { freezeAt, showGridlines, unfreeze, zoomTo } from './view'

/**
 * How a sheet is looked at.
 *
 * All of it is remembered in the file, so the test worth having is the one
 * that saves and opens again: a workbook put away at 60 % with its header row
 * frozen has to come back that way.
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

const reopened = async () => {
  const again = await openWorkbook(await workbookBytes(open, { edited: true }))
  const first = again.sheets[0]
  if (first === undefined) throw new Error('the workbook lost its sheets')
  return first
}

describe('freezing at the cursor', () => {
  it('holds still everything above and to the left of it', async () => {
    freezeAt(open, sheet, { row: 1, column: 0 })

    expect(sheet.sheet.view.panes).toEqual({ rows: 1, columns: 0, split: false })
    expect((await reopened()).sheet.view.panes?.rows).toBe(1)
  })

  it('freezes nothing from the corner, which is how the same command undoes it', () => {
    freezeAt(open, sheet, { row: 0, column: 0 })
    expect(sheet.sheet.view.panes).toBeNull()
  })

  it('unfreezes', async () => {
    freezeAt(open, sheet, { row: 2, column: 1 })
    unfreeze(open, sheet)

    expect((await reopened()).sheet.view.panes).toBeNull()
  })
})

describe('the zoom', () => {
  it('is remembered by the file', async () => {
    zoomTo(open, sheet, 60)

    expect(sheet.sheet.view.zoom).toBe(60)
    expect((await reopened()).sheet.view.zoom).toBe(60)
  })

  it('stays within what a spreadsheet allows', () => {
    zoomTo(open, sheet, 5000)
    expect(sheet.sheet.view.zoom).toBe(400)

    zoomTo(open, sheet, 1)
    expect(sheet.sheet.view.zoom).toBe(10)
  })
})

describe('the gridlines', () => {
  it('can be turned off and come back', async () => {
    showGridlines(open, sheet, false)
    expect((await reopened()).sheet.view.showGridLines).toBe(false)

    showGridlines(open, sheet, true)
    expect((await reopened()).sheet.view.showGridLines).toBe(true)
  })
})

describe('what a view change leaves alone', () => {
  it('keeps the cells', async () => {
    const was = sheet.cells.rows.get(0)?.get(0)?.value
    zoomTo(open, sheet, 150)

    expect((await reopened()).cells.rows.get(0)?.get(0)?.value).toBe(was)
  })

  it('leaves the other sheets as they were', async () => {
    const second = open.sheets[1]
    if (second === undefined) throw new Error('the fixture has one sheet')

    const was = second.sheet.view.zoom
    zoomTo(open, sheet, 150)

    const again = await openWorkbook(await workbookBytes(open, { edited: true }))
    expect(again.sheets[1]?.sheet.view.zoom).toBe(was)
  })
})
