import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { getPartText, readPackage } from '@orangery/ooxml-core'
import { cellAt, readTables } from '@orangery/ooxml-spreadsheet'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { columnNames, makeTable, toggleTotals } from './tables'
import { workbookBytes } from './save'

/**
 * A range made into a table.
 *
 * A table is not a style, however much the button that makes one says
 * "format as": it is a thing with a name and named columns, and
 * `Table1[Revenue]` means the column rather than the cells that are in it
 * today.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let open: OpenWorkbook
let sheet: OpenSheet

/** A block of the fixture: a heading row and figures under it. */
const range = { anchor: { row: 2, column: 0 }, focus: { row: 6, column: 1 } }

beforeEach(async () => {
  open = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
  const first = open.sheets[0]
  if (first === undefined) throw new Error('the fixture has no sheets')
  sheet = first
})

describe('naming the columns', () => {
  it('takes the names from the row above the figures', () => {
    const names = columnNames(open, sheet, 2, 0, 1)
    expect(names).toHaveLength(2)
    expect(names.every((one) => one !== '')).toBe(true)
  })

  it('makes up a name for a column that has none', () => {
    // Every column has to be called something, because a structured
    // reference names one of them.
    expect(columnNames(open, sheet, 200, 0, 2)).toEqual(['Column1', 'Column2', 'Column3'])
  })

  it('numbers the repeats, because two the same would mean either', () => {
    sheet.cells.rows.get(2)?.delete(0)
    sheet.cells.rows.get(2)?.delete(1)

    expect(columnNames(open, sheet, 2, 0, 1)).toEqual(['Column1', 'Column2'])
  })
})

describe('making one', () => {
  it('gives it a name nothing else in the workbook has', () => {
    const table = makeTable(open, sheet, range)

    expect(table?.name).toBe('Table1')
    expect(sheet.tables).toHaveLength(1)
  })

  it('writes the part, the relationship and the pointer from the sheet', () => {
    makeTable(open, sheet, range)

    expect(open.pkg.parts.has('xl/tables/table1.xml')).toBe(true)
    expect(getPartText(open.pkg, sheet.path)).toContain('<tableParts count="1">')
    expect(getPartText(open.pkg, '[Content_Types].xml')).toContain('table+xml')
  })

  it('refuses a range that already belongs to a table', () => {
    // Two tables over the same cells is a file Excel repairs.
    makeTable(open, sheet, range)
    expect(makeTable(open, sheet, range)).toBeNull()
  })

  it('refuses a single row, which is a header with nothing under it', () => {
    expect(
      makeTable(open, sheet, { anchor: { row: 2, column: 0 }, focus: { row: 2, column: 3 } }),
    ).toBeNull()
  })

  it('survives the trip through a saved file', async () => {
    const made = makeTable(open, sheet, range)
    const saved = await readPackage(await workbookBytes(open, { edited: true }), 'xl/workbook.xml')

    const tables = readTables(saved)
    expect(tables).toHaveLength(1)
    expect(tables[0]?.name).toBe(made?.name)
    expect(tables[0]?.columns).toHaveLength(2)
  })
})

describe('a totals row', () => {
  it('counts with SUBTOTAL, so it leaves out what a filter hid', () => {
    const table = makeTable(open, sheet, range)
    if (table === null) throw new Error('no table was made')

    toggleTotals(open, sheet, table)

    const row = Math.max(table.range.from.row, table.range.to.row)
    const total = cellAt(sheet.cells, { row, column: 1 })
    expect(total?.formula?.text).toBe(
      `SUBTOTAL(109,${table.name}[${table.columns[1]?.name ?? ''}])`,
    )
  })

  it('grows the table rather than sitting under it', () => {
    // Which is what makes it move when rows are added.
    const table = makeTable(open, sheet, range)
    if (table === null) throw new Error('no table was made')

    const before = Math.max(table.range.from.row, table.range.to.row)
    toggleTotals(open, sheet, table)

    expect(Math.max(table.range.from.row, table.range.to.row)).toBe(before + 1)
    expect(table.totalsRows).toBe(1)
  })

  it('calls the first column Total, where it has no figures to add', () => {
    const table = makeTable(open, sheet, range)
    if (table === null) throw new Error('no table was made')

    toggleTotals(open, sheet, table)
    const row = Math.max(table.range.from.row, table.range.to.row)

    expect(cellAt(sheet.cells, { row, column: 0 })?.value).toBe('Total')
  })

  it('takes it off again, cells and all', () => {
    const table = makeTable(open, sheet, range)
    if (table === null) throw new Error('no table was made')

    toggleTotals(open, sheet, table)
    const row = Math.max(table.range.from.row, table.range.to.row)
    toggleTotals(open, sheet, table)

    expect(table.totalsRows).toBe(0)
    expect(cellAt(sheet.cells, { row, column: 1 })).toBeNull()
  })
})
