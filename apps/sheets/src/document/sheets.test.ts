import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { applyEdit } from './edit'
import { openWorkbook } from './workbook'
import type { OpenWorkbook } from './workbook'
import { workbookBytes } from './save'
import {
  addSheet,
  colorTab,
  hideSheet,
  moveSheet,
  nextSheetName,
  removeSheet,
  renameSheet,
} from './sheets'

/**
 * The tabs along the bottom.
 *
 * Each operation moves the package and the model together, so the test worth
 * having is that both agree — and the strongest way to ask is to save and open
 * the file again, which reads everything back out of the package alone.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let open: OpenWorkbook

beforeEach(async () => {
  open = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
})

const named = (workbook: OpenWorkbook) => workbook.sheets.map((one) => one.name)

/** The workbook as it comes back off disk, which is the honest question. */
const reopened = async (workbook: OpenWorkbook) =>
  openWorkbook(await workbookBytes(workbook, { edited: true }))

describe('adding a sheet', () => {
  it('appears on screen and in the file', async () => {
    addSheet(open, { name: 'Extra' })

    expect(named(open)).toContain('Extra')
    expect(named(await reopened(open))).toContain('Extra')
  })

  it('goes in where it is asked to', () => {
    addSheet(open, { name: 'Extra', at: 1 })
    expect(named(open)[1]).toBe('Extra')
  })

  it('is empty, and is its own sheet', () => {
    const at = addSheet(open, { name: 'Extra' })
    expect(open.sheets[at ?? 0]?.cells.rows.size).toBe(0)
  })

  it('can be typed into and saved like any other', async () => {
    const at = addSheet(open, { name: 'Extra' })
    const sheet = open.sheets[at ?? 0]
    if (sheet === undefined) throw new Error('the sheet went missing')

    applyEdit(open, sheet, { row: 0, column: 0 }, 'hello')
    const again = await reopened(open)

    expect(
      again.sheets
        .find((one) => one.name === 'Extra')
        ?.cells.rows.get(0)
        ?.get(0)?.value,
    ).toBe('hello')
  })

  it('takes a name no other sheet has', () => {
    addSheet(open, { name: 'Budget' })
    expect(named(open).filter((name) => name === 'Budget')).toHaveLength(1)
  })

  it('suggests a name nothing is using', () => {
    expect(nextSheetName(open)).toBe('Sheet4')
  })
})

describe('duplicating a sheet', () => {
  it('carries what is on screen rather than what was last saved', async () => {
    const first = open.sheets[0]
    if (first === undefined) throw new Error('the fixture has no sheets')

    applyEdit(open, first, { row: 10, column: 0 }, 'typed just now')
    const at = addSheet(open, { name: 'Copy', copyOf: first })

    expect(open.sheets[at ?? 0]?.cells.rows.get(10)?.get(0)?.value).toBe('typed just now')

    const again = await reopened(open)
    expect(
      again.sheets
        .find((one) => one.name === 'Copy')
        ?.cells.rows.get(10)
        ?.get(0)?.value,
    ).toBe('typed just now')
  })

  it('is a sheet of its own, not a second view of the first', () => {
    const first = open.sheets[0]
    if (first === undefined) throw new Error('the fixture has no sheets')

    const at = addSheet(open, { name: 'Copy', copyOf: first })
    const copy = open.sheets[at ?? 0]
    if (copy === undefined) throw new Error('the copy went missing')

    applyEdit(open, copy, { row: 0, column: 0 }, 'changed')
    expect(first.cells.rows.get(0)?.get(0)?.value).not.toBe('changed')
  })
})

describe('renaming, moving and hiding', () => {
  it('renames on screen and in the file', async () => {
    renameSheet(open, 0, 'Renamed')

    expect(named(open)[0]).toBe('Renamed')
    expect(named(await reopened(open))[0]).toBe('Renamed')
  })

  it('moves a sheet and keeps its cells with it', async () => {
    const was = open.sheets[0]?.cells.rows.get(0)?.get(0)?.value
    moveSheet(open, 0, 1)

    const again = await reopened(open)
    expect(again.sheets[1]?.cells.rows.get(0)?.get(0)?.value).toBe(was)
  })

  it('hides a sheet without taking it away', async () => {
    hideSheet(open, 0, true)

    const again = await reopened(open)
    expect(again.sheets[0]?.hidden).toBe(true)
    expect(again.sheets).toHaveLength(open.sheets.length)
  })

  it('will not hide the last sheet somebody can see', () => {
    // A workbook showing nothing is one whose tabs cannot be got back to.
    for (const [at] of open.sheets.entries()) hideSheet(open, at, true)

    expect(open.sheets.filter((one) => !one.hidden).length).toBeGreaterThan(0)
  })

  it('puts a colour on a tab, and takes it off again', async () => {
    colorTab(open, 0, 'FFFF7A00')
    expect((await reopened(open)).sheets[0]?.sheet.tabColor).toBe('FFFF7A00')

    colorTab(open, 0, null)
    expect((await reopened(open)).sheets[0]?.sheet.tabColor).toBeNull()
  })
})

describe('taking a sheet away', () => {
  it('goes from the file as well as from the strip', async () => {
    const going = open.sheets[1]?.name
    removeSheet(open, 1)

    expect(named(open)).not.toContain(going)
    expect(named(await reopened(open))).not.toContain(going)
  })

  it('leaves the other sheets opening as they did', async () => {
    removeSheet(open, 1)
    const again = await reopened(open)

    expect(again.sheets[0]?.cells.rows.size).toBeGreaterThan(0)
  })

  it('leaves the package without a dangling relationship', () => {
    const path = open.sheets[1]?.path ?? ''
    removeSheet(open, 1)

    const rels = getPartText(open.pkg, 'xl/_rels/workbook.xml.rels') ?? ''
    expect(rels).not.toContain(path.replace('xl/', ''))
  })
})
