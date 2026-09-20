import { describe, expect, it } from 'vitest'
import { resolveStyle } from '@orangery/ooxml-spreadsheet'
import { csvFromSheet, guessOptions, previewRows, workbookFromCsv } from './csv-file'
import type { ImportOptions } from './csv-file'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * A table on its way in from, or out to, a text file.
 *
 * The import is only worth anything if what arrives is a spreadsheet rather
 * than a grid of strings: a number has to be a number, a date a date, and a
 * part number neither. The export is the same promise backwards — what comes
 * out is what somebody was looking at.
 */

const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text)

const OPTIONS: ImportOptions = {
  delimiter: ',',
  decimal: '.',
  encoding: 'utf-8',
  header: false,
}

const imported = async (text: string, options: Partial<ImportOptions> = {}) => {
  const open = await workbookFromCsv(bytesOf(text), { ...OPTIONS, ...options })
  const sheet = open.sheets[0]
  if (sheet === undefined) throw new Error('the import made no sheet')
  return { open, sheet }
}

const cellAt = (sheet: OpenSheet, row: number, column: number) =>
  sheet.cells.rows.get(row)?.get(column) ?? null

describe('what the wizard suggests', () => {
  it('reads the separator off the file', () => {
    expect(guessOptions(bytesOf('a;b\n1;2\n')).delimiter).toBe(';')
  })

  it('expects a comma for a decimal point where the fields are semicolons', () => {
    // The two go together: a file uses a semicolon because its numbers
    // already have the comma.
    expect(guessOptions(bytesOf('a;b\n1;2\n')).decimal).toBe(',')
    expect(guessOptions(bytesOf('a,b\n1,2\n')).decimal).toBe('.')
  })

  it('shows the first rows as they would be read', () => {
    const rows = previewRows(bytesOf('a;b\n1;2\n'), { ...OPTIONS, delimiter: ';' })
    expect(rows).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ])
  })

  it('shows no more than a screenful', () => {
    const text = Array.from({ length: 50 }, (_, row) => `${String(row)},x`).join('\n')
    expect(previewRows(bytesOf(text), OPTIONS)).toHaveLength(20)
  })
})

describe('a file becoming a workbook', () => {
  it('makes a number a number rather than the text of one', async () => {
    const { sheet } = await imported('12.5\n')

    expect(cellAt(sheet, 0, 0)?.type).toBe('n')
    expect(cellAt(sheet, 0, 0)?.value).toBe('12.5')
  })

  it('makes a date a date, which is a serial number', async () => {
    const { sheet } = await imported('2026-09-19\n')
    expect(cellAt(sheet, 0, 0)?.value).toBe('46284')
  })

  it('leaves a part number alone', async () => {
    // 007-42 is not a subtraction and not a date.
    const { sheet } = await imported('007-42\n')

    expect(cellAt(sheet, 0, 0)?.type).toBe('inlineStr')
    expect(cellAt(sheet, 0, 0)?.value).toBe('007-42')
  })

  it('applies the decimal point it was told about', async () => {
    const { sheet } = await imported('12,50\n', { delimiter: ';', decimal: ',' })

    expect(cellAt(sheet, 0, 0)?.type).toBe('n')
    expect(cellAt(sheet, 0, 0)?.value).toBe('12.5')
  })

  it('leaves an empty field empty rather than storing a blank', async () => {
    const { sheet } = await imported('a,,c\n')
    expect(cellAt(sheet, 0, 1)).toBeNull()
  })

  it('reads the words in the encoding it was given', async () => {
    // The same four bytes are a Ukrainian city read as 1251 and four
    // unrelated letters read as anything else.
    const cyrillic = await workbookFromCsv(new Uint8Array([0xca, 0xe8, 0xbf, 0xe2]), {
      ...OPTIONS,
      encoding: 'windows-1251',
    })
    const sheet = cyrillic.sheets[0]
    if (sheet === undefined) throw new Error('the import made no sheet')

    expect(cellAt(sheet, 0, 0)?.value).toBe('Київ')
  })
})

describe('the row that names the columns', () => {
  const TABLE = 'name,amount\nchair,12\ntable,99\n'

  it('is made bold, so it reads as a header', async () => {
    const { open, sheet } = await imported(TABLE, { header: true })
    const cell = cellAt(sheet, 0, 0)
    if (cell === null || open.styles === null) throw new Error('the header went missing')

    expect(resolveStyle(open.styles, cell.style).font?.bold).toBe(true)
  })

  it('gets the arrows, because that is what a header is for', async () => {
    const { sheet } = await imported(TABLE, { header: true })

    expect(sheet.sheet.autoFilter?.range.from).toEqual({ row: 0, column: 0 })
    expect(sheet.sheet.autoFilter?.range.to).toEqual({ row: 2, column: 1 })
  })

  it('is left as data where somebody said it was data', async () => {
    const { open, sheet } = await imported(TABLE, { header: false })
    const cell = cellAt(sheet, 0, 0)
    if (cell === null || open.styles === null) throw new Error('the row went missing')

    expect(sheet.sheet.autoFilter).toBeNull()
    expect(resolveStyle(open.styles, cell.style).font?.bold).not.toBe(true)
  })

  it('is not marked on a file of one row, which has no data under it', async () => {
    const { sheet } = await imported('name,amount\n', { header: true })
    expect(sheet.sheet.autoFilter).toBeNull()
  })
})

describe('a sheet becoming a file', () => {
  const exported = async (text: string, options: Partial<ImportOptions> = {}) => {
    const { open, sheet } = await imported(text, options)
    return csvFromSheet(open, sheet, ',')
  }

  it('writes the values somebody was looking at', async () => {
    expect(await exported('name,amount\nchair,12\n')).toBe('name,amount\r\nchair,12')
  })

  it('writes a date as a date and not as its serial number', async () => {
    // What is stored is 46284; nobody wants that in a `.csv`.
    expect(await exported('2026-09-19\n')).toContain('2026-09-19')
  })

  it('keeps the empty rows, so the rows still line up', async () => {
    const { open, sheet } = await imported('a\n\n\nb\n')
    expect(csvFromSheet(open, sheet, ',').split('\r\n')).toEqual(['a', '', '', 'b'])
  })

  it('quotes a field holding the separator', async () => {
    const { open, sheet } = await imported('"Lviv, Halytskyi"\n')
    expect(csvFromSheet(open, sheet, ',')).toBe('"Lviv, Halytskyi"')
  })

  it('uses the separator it was asked for', async () => {
    const { open, sheet }: { open: OpenWorkbook; sheet: OpenSheet } = await imported('a,b\n')
    expect(csvFromSheet(open, sheet, ';')).toBe('a;b')
  })
})
