import { describe, expect, it } from 'vitest'
import { cellAt } from '@orangery/ooxml-spreadsheet'
import { isOds, odsBytes, workbookFromOds } from './ods-file'
import { readOds } from './ods'
import { workbookFromCsv } from '../csv-file'

/**
 * A spreadsheet in from, and out to, OpenDocument.
 *
 * The test that means something is the whole way round: a workbook written as
 * an `.ods` and read back has to be the same workbook — the same numbers, the
 * same dates, the same formulas, the same cells drawn as one. Anything that
 * only checks the XML checks our own opinion of it.
 */

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

const fromCsv = (text: string) =>
  workbookFromCsv(bytesOf(text), {
    delimiter: ',',
    decimal: '.',
    encoding: 'utf-8',
    header: false,
  })

/** A workbook out to `.ods` and back in again. */
const roundTrip = async (text: string) => {
  const open = await fromCsv(text)
  const again = await workbookFromOds(await odsBytes(open))

  const sheet = again.sheets[0]
  if (sheet === undefined) throw new Error('the file came back with no sheets')
  return { open: again, sheet }
}

describe('a workbook that goes out and comes back', () => {
  it('keeps the words', async () => {
    const { sheet } = await roundTrip('name,amount\nchair,12\n')
    expect(cellAt(sheet.cells, { row: 0, column: 0 })?.value).toBe('name')
  })

  it('keeps a number a number', async () => {
    const { sheet } = await roundTrip('12.5\n')
    const cell = cellAt(sheet.cells, { row: 0, column: 0 })

    expect(cell?.type).toBe('n')
    expect(Number(cell?.value)).toBe(12.5)
  })

  it('keeps a date a date rather than the number behind it', async () => {
    const { open, sheet } = await roundTrip('2026-09-19\n')
    const cell = cellAt(sheet.cells, { row: 0, column: 0 })

    // The same serial number it had on the way out, which is what makes it a
    // date rather than a five-figure number.
    expect(cell?.value).toBe('46284')
    expect(open.styles).not.toBeNull()
  })

  it('keeps a percentage as the fraction it is', async () => {
    const { sheet } = await roundTrip('15%\n')
    expect(Number(cellAt(sheet.cells, { row: 0, column: 0 })?.value)).toBeCloseTo(0.15)
  })

  it('keeps a part number out of the hands of the value reader', async () => {
    // It went out as a string and has to come back as one, or a file with a
    // column of part numbers comes back as a column of dates.
    const { sheet } = await roundTrip('007-42\n')
    const cell = cellAt(sheet.cells, { row: 0, column: 0 })

    expect(cell?.value).toBe('007-42')
    expect(cell?.type).not.toBe('n')
  })

  it('keeps the shape of a table with gaps in it', async () => {
    const { sheet } = await roundTrip('a,,c\n\nd\n')

    expect(cellAt(sheet.cells, { row: 0, column: 2 })?.value).toBe('c')
    expect(cellAt(sheet.cells, { row: 2, column: 0 })?.value).toBe('d')
    expect(cellAt(sheet.cells, { row: 0, column: 1 })).toBeNull()
  })
})

describe('what an exported file says about itself', () => {
  it('is an OpenDocument spreadsheet, and says so first', async () => {
    const open = await fromCsv('a\n')
    const bytes = await odsBytes(open)

    expect(await isOds(bytes)).toBe(true)
  })

  it('names its sheets the way the workbook does', async () => {
    const open = await fromCsv('a\n')
    const sheets = await readOds(await odsBytes(open))

    expect(sheets[0]?.name).toBe(open.sheets[0]?.name)
  })

  it('is not an `.ods` when it is a workbook', async () => {
    const { workbookBytes } = await import('../save')
    const open = await fromCsv('a\n')

    expect(await isOds(await workbookBytes(open, { edited: true }))).toBe(false)
  })
})

describe('a file with more than one sheet', () => {
  it('comes back with all of them, named as they were', async () => {
    const open = await fromCsv('first\n')
    const { addSheet } = await import('../sheets')

    const at = addSheet(open, { name: 'Second' })
    const second = open.sheets[at ?? 1]
    if (second === undefined) throw new Error('the sheet was not added')

    const { applyEdit } = await import('../edit')
    applyEdit(open, second, { row: 0, column: 0 }, 'over here')

    const again = await workbookFromOds(await odsBytes(open))

    expect(again.sheets).toHaveLength(2)
    expect(again.sheets[1]?.name).toBe('Second')
    expect(
      cellAt(again.sheets[1]?.cells ?? { rows: new Map(), properties: new Map() }, {
        row: 0,
        column: 0,
      })?.value,
    ).toBe('over here')
  })
})
