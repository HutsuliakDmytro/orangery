import { describe, expect, it } from 'vitest'
import { getPartText, readPackage } from '@orangery/ooxml-core'
import {
  cellAt as cellOf,
  formatCodeOf,
  readWorksheet,
  resolveStyle,
} from '@orangery/ooxml-spreadsheet'
import { blankWorkbook } from './new'
import { openWorkbook, visibleSheets } from './workbook'
import { TEMPLATES, fillTemplate } from './templates'
import { workbookBytes } from './save'

/**
 * Workbooks that start with something in them.
 *
 * A template's job is not to be pretty: it is to show where the figures go
 * and to have the sums already written, so that the first thing somebody does
 * is type a number.
 */

const made = async (name: Parameters<typeof fillTemplate>[2]) => {
  const open = await openWorkbook(await blankWorkbook())
  const sheet = visibleSheets(open)[0]
  if (sheet === undefined) throw new Error('a blank workbook has no sheets')

  fillTemplate(open, sheet, name)
  return { open, sheet }
}

describe('every template', () => {
  it.each(TEMPLATES.map((one) => [one.name, one.label] as const))(
    '%s puts something on the sheet',
    async (name) => {
      const { sheet } = await made(name)
      expect(sheet.cells.rows.size).toBeGreaterThan(2)
    },
  )

  it.each(TEMPLATES.map((one) => [one.name] as const))('%s survives a save', async (name) => {
    const { open, sheet } = await made(name)
    const saved = await readPackage(await workbookBytes(open, { edited: true }), 'xl/workbook.xml')

    const again = readWorksheet(getPartText(saved, sheet.path) ?? '')
    expect(again).not.toBeNull()
    expect(getPartText(saved, sheet.path) ?? '').toContain('<sheetData>')
  })
})

describe('the budget', () => {
  it('has its sums written before the figures are', async () => {
    // Somebody types into the middle of a column and the total moves, which
    // is the whole point of giving them a template rather than a grid.
    const { sheet } = await made('budget')
    const total = cellOf(sheet.cells, { row: 8, column: 1 })

    expect(total?.formula?.text).toBe('SUM(B4:B8)')
  })

  it('shows money as money', async () => {
    const { open, sheet } = await made('budget')
    const cell = cellOf(sheet.cells, { row: 3, column: 1 })
    const styles = open.styles
    if (styles === null) throw new Error('a new workbook has styles')

    expect(formatCodeOf(styles, resolveStyle(styles, cell?.style ?? null).numberFormat)).toBe(
      '#,##0.00',
    )
  })
})

describe('the cash book', () => {
  it('carries the balance down, which is the formula everybody gets wrong', async () => {
    const { sheet } = await made('ledger')
    const balance = cellOf(sheet.cells, { row: 4, column: 4 })

    expect(balance?.formula?.text).toBe('E4+C5-D5')
  })
})

describe('the ДСТУ table', () => {
  it('numbers its columns under their names, which is the part people forget', async () => {
    const { sheet } = await made('academic')

    expect(cellOf(sheet.cells, { row: 2, column: 0 })?.value).toBe('1')
    expect(cellOf(sheet.cells, { row: 2, column: 3 })?.value).toBe('4')
  })

  it('puts the caption above it and to the left', async () => {
    const { sheet } = await made('academic')
    expect(cellOf(sheet.cells, { row: 0, column: 0 })?.value).toContain('Таблиця')
  })
})
