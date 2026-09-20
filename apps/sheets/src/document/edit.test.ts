import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { getPartText, readPackage } from '@orangery/ooxml-core'
import { cellAt, formatCodeOf, resolveStyle } from '@orangery/ooxml-spreadsheet'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { applyEdit } from './edit'
import { workbookBytes } from './save'

/**
 * Typing into a cell.
 *
 * Two questions, and the second is the one that bites: what kind of thing was
 * typed, and what the cell has to look like for it to read back as that. A
 * percentage stored without a format is a cell that divided itself by a
 * hundred in front of somebody.
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

/** The cell as the model holds it, after something was typed into it. */
const typed = (text: string, into = { row: 8, column: 5 }) => {
  applyEdit(open, sheet, into, text)
  return cellAt(sheet.cells, into)
}

/** What the cell's style says it should be shown as. */
const shownAs = (style: number | null): string | null =>
  open.styles === null
    ? null
    : formatCodeOf(open.styles, resolveStyle(open.styles, style).numberFormat)

describe('what a typed value becomes', () => {
  it('keeps a number as a number', () => {
    expect(typed('42')).toMatchObject({ type: 'n', value: '42' })
  })

  it('keeps words as words', () => {
    expect(typed('Rent')).toMatchObject({ type: 'inlineStr', value: 'Rent' })
  })

  it('keeps a number somebody insisted was text', () => {
    expect(typed("'0042")).toMatchObject({ type: 'inlineStr', value: '0042' })
  })

  it('takes a cell away rather than leaving it blank', () => {
    // A `<c>` with no `<v>` is an empty string to some readers and nothing to
    // others; absent is the one form everybody agrees about.
    typed('42')
    expect(typed('')).toBeNull()
  })

  it('forgets the formula a typed value replaces', () => {
    // C4 holds `B2+B3`. A cell showing a number its own formula denies is
    // worse than one that simply holds the number.
    const cell = typed('7', { row: 3, column: 2 })

    expect(cell?.formula).toBeNull()
    expect(cell?.value).toBe('7')
  })
})

describe('the format a typed value asks for', () => {
  it('gives a percentage one, so it does not read as a fraction', () => {
    const cell = typed('15%')

    expect(cell?.value).toBe('0.15')
    expect(shownAs(cell?.style ?? null)).toBe('0.00%')
  })

  it('gives a date one, so it does not read as a five-figure number', () => {
    const cell = typed('2026-09-19')

    expect(cell?.value).toBe('46284')
    expect(shownAs(cell?.style ?? null)).toBe('yyyy-mm-dd')
  })

  it('leaves the format a cell already had where typing implies none', () => {
    // B2 shows `#,##0.00`. Typing 12 into a formatted column is somebody
    // filling it in, not somebody changing it.
    const cell = typed('12', { row: 1, column: 1 })
    expect(shownAs(cell?.style ?? null)).toBe('#,##0.00')
  })

  it('adds one style entry however many cells ask for the same look', () => {
    typed('15%', { row: 8, column: 5 })
    typed('25%', { row: 9, column: 5 })

    expect(open.styleChanges.cellFormats).toHaveLength(1)
    expect(cellAt(sheet.cells, { row: 8, column: 5 })?.style).toBe(
      cellAt(sheet.cells, { row: 9, column: 5 })?.style,
    )
  })
})

describe('an edited workbook, written back', () => {
  it('carries the value and the style it needed into the file', async () => {
    applyEdit(open, sheet, { row: 8, column: 5 }, '15%')
    const after = await readPackage(await workbookBytes(open, { edited: true }), 'xl/workbook.xml')

    expect(getPartText(after, 'xl/worksheets/sheet1.xml')).toContain('<v>0.15</v>')
    expect(getPartText(after, 'xl/styles.xml')).toContain('<cellXfs count="8">')
  })

  it('opens again showing what was typed, which is the whole of the claim', async () => {
    applyEdit(open, sheet, { row: 8, column: 5 }, '15%')
    const again = await openWorkbook(await workbookBytes(open, { edited: true }))

    const cell = cellAt(again.sheets[0]?.cells ?? { rows: new Map(), properties: new Map() }, {
      row: 8,
      column: 5,
    })
    const styles = again.styles

    expect(cell?.value).toBe('0.15')
    expect(
      styles === null
        ? null
        : formatCodeOf(styles, resolveStyle(styles, cell?.style ?? 0).numberFormat),
    ).toBe('0.00%')
  })

  it('leaves `styles.xml` alone when nothing was typed', async () => {
    const before = await readPackage(new Uint8Array(await readFile(FIXTURE)), 'xl/workbook.xml')
    const after = await readPackage(await workbookBytes(open), 'xl/workbook.xml')

    expect(getPartText(after, 'xl/styles.xml')).toBe(getPartText(before, 'xl/styles.xml'))
  })
})
