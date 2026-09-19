import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { cellAt } from '@orangery/ooxml-spreadsheet'
import { openWorkbook, visibleSheets } from './workbook'

/**
 * A workbook, opened.
 *
 * The fixture is small and deliberate: a frozen corner, a merge, a wide first
 * column, a tall row, a hidden sheet, and one cell of each kind that is read
 * differently from how it is stored.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')
const open = async () => openWorkbook(new Uint8Array(await readFile(FIXTURE)))

describe('opening a workbook', () => {
  it('reads the sheets, in the order the file lists them', async () => {
    const workbook = await open()
    expect(workbook.sheets.map((sheet) => sheet.name)).toEqual(['Budget', 'Notes', 'Working'])
  })

  it('keeps a hidden sheet out of the tabs and in the file', async () => {
    const workbook = await open()

    expect(visibleSheets(workbook).map((sheet) => sheet.name)).toEqual(['Budget', 'Notes'])
    expect(workbook.pkg.parts.has('xl/worksheets/sheet3.xml')).toBe(true)
  })

  it('reads the cells of each sheet', async () => {
    const workbook = await open()
    const budget = workbook.sheets[0]

    expect(
      cellAt(budget?.cells ?? { rows: new Map(), properties: new Map() }, { row: 1, column: 1 })
        ?.value,
    ).toBe('1234.5')
  })

  it('reads what the sheet says about itself', async () => {
    const workbook = await open()
    const budget = workbook.sheets[0]

    expect(budget?.sheet.view.panes).toEqual({ rows: 1, columns: 1, split: false })
    expect(budget?.sheet.merges).toHaveLength(1)
    expect(budget?.sheet.columns[0]?.width).toBe(20)
  })

  it('reads the shared strings every text cell points into, formatting and all', async () => {
    const workbook = await open()
    expect(workbook.strings.map((one) => one.text)).toContain('January')
  })

  it('reads the styles and the theme the colours come from', async () => {
    const workbook = await open()

    // What a style has to answer, rather than how many of them there are: the
    // count changes whenever the fixture grows a cell, and says nothing.
    expect(workbook.styles?.cellFormats[1]).toMatchObject({ font: 1, fill: 2 })
    expect(workbook.palette.scheme.get('accent1')).toBe('4472C4')
  })

  it('refuses a zip that is not a workbook, and says so where it happens', async () => {
    await expect(openWorkbook(new Uint8Array([1, 2, 3]))).rejects.toThrow()
  })
})
