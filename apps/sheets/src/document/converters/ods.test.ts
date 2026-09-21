import { describe, expect, it } from 'vitest'
import { formulaFrom, readOdsContent } from './ods'

/**
 * OpenDocument Spreadsheet, read.
 *
 * The cases that matter are the two things ODF does differently from
 * SpreadsheetML: it repeats rows and cells rather than writing them out, and
 * it spells references in an alphabet of its own.
 */

const content = (tables: string) =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<office:document-content ' +
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0">' +
  `<office:body><office:spreadsheet>${tables}</office:spreadsheet></office:body>` +
  '</office:document-content>'

const table = (rows: string, name = 'Sheet1') =>
  content(`<table:table table:name="${name}">${rows}</table:table>`)

const row = (cells: string, attributes = '') =>
  `<table:table-row${attributes === '' ? '' : ` ${attributes}`}>${cells}</table:table-row>`

const first = (xml: string) => {
  const sheets = readOdsContent(xml)
  const sheet = sheets[0]
  if (sheet === undefined) throw new Error('the file has no sheets')
  return sheet
}

const at = (xml: string, row: number, column: number) =>
  first(xml).cells.find((cell) => cell.row === row && cell.column === column)

describe('what a file holds', () => {
  it('reads a sheet by the name it is given', () => {
    expect(first(table(row('<table:table-cell/>'), 'Budget')).name).toBe('Budget')
  })

  it('reads a number as the number it is', () => {
    const xml = table(
      row(
        '<table:table-cell office:value-type="float" office:value="12.5"><text:p>12,5</text:p></table:table-cell>',
      ),
    )

    expect(at(xml, 0, 0)?.typed).toBe('12.5')
  })

  it('reads text as text, even where it looks like something else', () => {
    // A part number that looks like a date is a part number, and the file
    // said which it was.
    const xml = table(
      row('<table:table-cell office:value-type="string"><text:p>07-42</text:p></table:table-cell>'),
    )

    expect(at(xml, 0, 0)?.typed).toBe("'07-42")
  })

  it('reads a date as a date', () => {
    const xml = table(
      row('<table:table-cell office:value-type="date" office:date-value="2026-09-19"/>'),
    )

    expect(at(xml, 0, 0)?.typed).toBe('2026-09-19')
  })

  it('reads a percentage as one, rather than as the fraction behind it', () => {
    const xml = table(row('<table:table-cell office:value-type="percentage" office:value="0.15"/>'))

    expect(at(xml, 0, 0)?.typed).toBe('15%')
  })

  it('reads a time out of the duration ODF writes it as', () => {
    const xml = table(
      row('<table:table-cell office:value-type="time" office:time-value="PT01H30M00S"/>'),
    )
    expect(at(xml, 0, 0)?.typed).toBe('01:30:00')
  })

  it('reads a boolean by name, not by number', () => {
    const xml = table(
      row('<table:table-cell office:value-type="boolean" office:boolean-value="true"/>'),
    )

    expect(at(xml, 0, 0)?.typed).toBe('TRUE')
  })

  it('keeps the lines of a cell written in several paragraphs', () => {
    const xml = table(
      row(
        '<table:table-cell office:value-type="string"><text:p>one</text:p><text:p>two</text:p></table:table-cell>',
      ),
    )

    expect(at(xml, 0, 0)?.typed).toBe("'one\ntwo")
  })
})

describe('the things ODF repeats rather than writing out', () => {
  it('skips a run of empty cells instead of building them', () => {
    const xml = table(
      row(
        '<table:table-cell table:number-columns-repeated="16384"/>' +
          '<table:table-cell office:value-type="float" office:value="1"/>',
      ),
    )

    expect(first(xml).cells).toHaveLength(1)
    expect(first(xml).cells[0]?.column).toBe(16384)
  })

  it('builds a run of filled cells, because those are really there', () => {
    const xml = table(
      row(
        '<table:table-cell table:number-columns-repeated="3" office:value-type="float" office:value="7"/>',
      ),
    )

    expect(first(xml).cells.map((cell) => cell.column)).toEqual([0, 1, 2])
  })

  it('counts an empty repeated row without building anything', () => {
    const xml = table(
      row('<table:table-cell/>', 'table:number-rows-repeated="500"') +
        row('<table:table-cell office:value-type="float" office:value="1"/>'),
    )

    expect(first(xml).cells).toHaveLength(1)
    expect(first(xml).cells[0]?.row).toBe(500)
  })

  it('repeats a filled row as the rows it stands for', () => {
    const xml = table(
      row(
        '<table:table-cell office:value-type="float" office:value="1"/>',
        'table:number-rows-repeated="3"',
      ),
    )

    expect(first(xml).cells.map((cell) => cell.row)).toEqual([0, 1, 2])
  })
})

describe('cells drawn as one', () => {
  it('reads the span off the cell that covers the others', () => {
    const xml = table(
      row(
        '<table:table-cell table:number-columns-spanned="2" table:number-rows-spanned="1" ' +
          'office:value-type="string"><text:p>Wide</text:p></table:table-cell>' +
          '<table:covered-table-cell/>',
      ),
    )

    expect(at(xml, 0, 0)?.spans).toEqual({ rows: 1, columns: 2 })
  })

  it('leaves the covered cells out, since the merge is on the other one', () => {
    const xml = table(
      row(
        '<table:table-cell table:number-columns-spanned="2" office:value-type="string">' +
          '<text:p>Wide</text:p></table:table-cell><table:covered-table-cell/>' +
          '<table:table-cell office:value-type="float" office:value="3"/>',
      ),
    )

    expect(first(xml).cells).toHaveLength(2)
    expect(first(xml).cells[1]?.column).toBe(2)
  })
})

describe('a formula in the other alphabet', () => {
  it('reads a range as the range it is', () => {
    expect(formulaFrom('of:=SUM([.A1:.A3])')).toBe('SUM(A1:A3)')
  })

  it('reads a single reference', () => {
    expect(formulaFrom('of:=[.B2]*2')).toBe('B2*2')
  })

  it('names another sheet the way a spreadsheet does', () => {
    expect(formulaFrom('of:=[$Notes.A1]')).toBe('Notes!A1')
  })

  it('separates arguments with commas', () => {
    expect(formulaFrom('of:=IF([.A1]>0;1;2)')).toBe('IF(A1>0,1,2)')
  })

  it('is nothing for something that is not a formula', () => {
    expect(formulaFrom('SUM(A1)')).toBeNull()
  })

  it('arrives on the cell it belongs to', () => {
    const xml = table(
      row(
        '<table:table-cell table:formula="of:=SUM([.A1:.A3])" office:value-type="float" ' +
          'office:value="6"/>',
      ),
    )

    expect(at(xml, 0, 0)?.formula).toBe('SUM(A1:A3)')
    expect(at(xml, 0, 0)?.typed).toBe('6')
  })
})

describe('a file that is not one', () => {
  it('has no sheets rather than an error', () => {
    expect(readOdsContent('<office:document-content/>')).toEqual([])
    expect(readOdsContent('')).toEqual([])
  })
})
