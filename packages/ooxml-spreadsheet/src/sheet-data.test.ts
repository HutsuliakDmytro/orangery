import { describe, expect, it } from 'vitest'
import { cellAt, cellsOfRow, extentOf, rowsWithCells } from './cells'
import { readSheetData, replaceSheetData, scanSheetData, writeSheetData } from './sheet-data'
import type { Cell } from './cells'

/**
 * Reading a worksheet's cells without building a tree.
 *
 * Every test here is about the same thing from a different side: what the file
 * says has to come back out of a save unchanged, including the parts this does
 * not understand.
 */

const SHEET =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<worksheet xmlns="x"><dimension ref="A1:C4"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>' +
  '<cols><col min="1" max="1" width="18" customWidth="1"/></cols>' +
  '<sheetData>' +
  '<row r="1" spans="1:3"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Revenue</t></is></c></row>' +
  '<row r="2" spans="1:3" ht="24" customHeight="1"><c r="A2" s="1"><v>10.5</v></c>' +
  '<c r="C2" s="2" t="str"><f>A2*2</f><v>21</v></c></row>' +
  '<row r="4" hidden="1"><c r="A4" cm="1" vm="3"><v>7</v></c>' +
  '<c r="B4" t="e"><v>#DIV/0!</v></c></row>' +
  '</sheetData><pageMargins left="0.7"/></worksheet>'

const at = (sheet: ReturnType<typeof readSheetData>, reference: string): Cell | null => {
  const row = Number(reference.replace(/^[A-Z]+/u, '')) - 1
  const column = reference.replace(/\d+$/u, '').charCodeAt(0) - 65
  return cellAt(sheet, { row, column })
}

describe('reading the cells', () => {
  const sheet = readSheetData(SHEET)

  it('finds only the cells that are there, which is most of what a sheet is not', () => {
    expect(rowsWithCells(sheet)).toEqual([0, 1, 3])
    expect(at(sheet, 'B2')).toBeNull()
  })

  it('reads a value as the text the file states', () => {
    // Not as a double: `0.1 + 0.2` is a question for the formula engine, and a
    // reader that parsed every cell would hand it a number nobody wrote.
    expect(at(sheet, 'A2')?.value).toBe('10.5')
    expect(at(sheet, 'A2')?.type).toBe('n')
  })

  it('reads the type, which says how to read the value', () => {
    expect(at(sheet, 'A1')?.type).toBe('s')
    expect(at(sheet, 'A1')?.value).toBe('0')
    expect(at(sheet, 'B4')?.type).toBe('e')
    expect(at(sheet, 'B4')?.value).toBe('#DIV/0!')
  })

  it('reads an inline string from the cell rather than from the table', () => {
    expect(at(sheet, 'B1')?.value).toBe('Revenue')
  })

  it('reads the style index, and leaves it null where the cell states none', () => {
    expect(at(sheet, 'A2')?.style).toBe(1)
    expect(at(sheet, 'A1')?.style).toBeNull()
  })

  it('reads a formula with its cached result beside it', () => {
    const cell = at(sheet, 'C2')

    expect(cell?.formula?.text).toBe('A2*2')
    expect(cell?.formula?.kind).toBe('normal')
    expect(cell?.value).toBe('21')
  })

  it('carries the attributes it does not model', () => {
    // `cm` and `vm` are what a dynamic array is recognised by; a cell that
    // dropped them would lose something invisible on the first save.
    expect(at(sheet, 'A4')?.carried).toEqual({ cm: '1', vm: '3' })
    expect(at(sheet, 'A2')?.carried).toBeNull()
  })

  it('reads what a row says about itself', () => {
    expect(sheet.properties.get(1)).toMatchObject({ height: 24, customHeight: true })
    expect(sheet.properties.get(3)?.hidden).toBe(true)
  })

  it('counts how far the cells reach, which is not what dimension claims', () => {
    expect(extentOf(sheet)).toEqual({ rows: 4, columns: 3 })
  })

  it('reads the cells of a row left to right', () => {
    expect(cellsOfRow(sheet, 1).map((cell) => cell.column)).toEqual([0, 2])
  })
})

describe('reading without a tree', () => {
  it('hands out cells as it passes them, keeping nothing', () => {
    const seen: string[] = []
    scanSheetData(SHEET, {
      onCell: (cell) => seen.push(`${String(cell.row)},${String(cell.column)}`),
    })

    expect(seen).toEqual(['0,0', '0,1', '1,0', '1,2', '3,0', '3,1'])
  })

  it('reads a sheet whose cells do not say where they are', () => {
    // A writer may leave `r` off, and then a cell's place is where it falls.
    const terse =
      '<sheetData><row><c><v>1</v></c><c><v>2</v></c></row><row><c><v>3</v></c></row></sheetData>'
    const sheet = readSheetData(terse)

    expect(cellAt(sheet, { row: 0, column: 1 })?.value).toBe('2')
    expect(cellAt(sheet, { row: 1, column: 0 })?.value).toBe('3')
  })

  it('reads the entities XML insists on', () => {
    const escaped =
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>R&amp;D &lt;1&gt;</t></is></c></row></sheetData>'
    expect(readSheetData(escaped).rows.get(0)?.get(0)?.value).toBe('R&D <1>')
  })

  it('joins the runs of a string split across them', () => {
    // One word in bold does not make two strings.
    const runs =
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><r><t>Co</t></r><r><t>sts</t></r></is></c></row></sheetData>'
    expect(readSheetData(runs).rows.get(0)?.get(0)?.value).toBe('Costs')
  })

  it('says nothing about a part that holds no cells at all', () => {
    expect(rowsWithCells(readSheetData('<worksheet/>'))).toEqual([])
    expect(rowsWithCells(readSheetData('<sheetData/>'))).toEqual([])
  })
})

describe('writing the cells back', () => {
  it('gives back what it read, cell for cell', () => {
    const before = readSheetData(SHEET)
    const after = readSheetData(writeSheetData(before))

    expect(rowsWithCells(after)).toEqual(rowsWithCells(before))
    expect(at(after, 'C2')).toEqual(at(before, 'C2'))
    expect(at(after, 'A4')?.carried).toEqual({ cm: '1', vm: '3' })
  })

  it('keeps what a row said about itself', () => {
    const written = writeSheetData(readSheetData(SHEET))

    expect(written).toContain('ht="24"')
    expect(written).toContain('customHeight="1"')
    expect(written).toContain('hidden="1"')
  })

  it('writes rows in order and cells left to right', () => {
    const sheet = readSheetData(
      '<sheetData><row r="3"><c r="C3"><v>3</v></c><c r="A3"><v>1</v></c></row>' +
        '<row r="1"><c r="A1"><v>0</v></c></row></sheetData>',
    )
    const written = writeSheetData(sheet)

    // Excel sorts a sheet that says otherwise on save, which turns a one-cell
    // edit into a whole-file diff.
    expect(written.indexOf('r="1"')).toBeLessThan(written.indexOf('r="3"'))
    expect(written.indexOf('r="A3"')).toBeLessThan(written.indexOf('r="C3"'))
  })

  it('escapes what would otherwise end the element', () => {
    const sheet = readSheetData(
      '<sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>R&amp;D</t></is></c></row></sheetData>',
    )
    expect(writeSheetData(sheet)).toContain('R&amp;D')
  })
})

describe('putting the cells back into the part', () => {
  it('leaves every other element exactly as it was', () => {
    const written = replaceSheetData(SHEET, readSheetData(SHEET))

    expect(written).toContain('<dimension ref="A1:C4"/>')
    expect(written).toContain('<col min="1" max="1" width="18" customWidth="1"/>')
    expect(written).toContain('<pageMargins left="0.7"/>')
    expect(written.startsWith('<?xml version="1.0"')).toBe(true)
  })

  it('replaces the cells and nothing around them', () => {
    const sheet = readSheetData(SHEET)
    const cell = sheet.rows.get(1)?.get(0)
    if (cell !== undefined) cell.value = '99'

    const written = replaceSheetData(SHEET, sheet)

    expect(written).toContain('<v>99</v>')
    expect(written).not.toContain('<v>10.5</v>')
    expect(written).toContain('<sheetView workbookViewId="0"/>')
  })

  it('leaves a part with no cells in it alone', () => {
    expect(replaceSheetData('<worksheet/>', readSheetData(SHEET))).toBe('<worksheet/>')
  })
})

describe('a sheet the size of a real one', () => {
  /** Twenty thousand rows of five cells, which is a middling workbook. */
  const large = (rows: number): string => {
    const cells = ['A', 'B', 'C', 'D', 'E']
    const body = Array.from({ length: rows }, (_, row) => {
      const number = String(row + 1)
      return (
        `<row r="${number}" spans="1:5">` +
        cells
          .map((column, index) =>
            index === 0
              ? `<c r="${column}${number}" t="inlineStr"><is><t>Row ${number}</t></is></c>`
              : `<c r="${column}${number}" s="1"><v>${String(row * index)}</v></c>`,
          )
          .join('') +
        '</row>'
      )
    }).join('')

    return `<worksheet><sheetData>${body}</sheetData></worksheet>`
  }

  it('reads a hundred thousand cells without building a tree', () => {
    const xml = large(20_000)
    const started = performance.now()
    const sheet = readSheetData(xml)
    const took = performance.now() - started

    expect(sheet.rows.size).toBe(20_000)
    expect(cellAt(sheet, { row: 19_999, column: 4 })?.value).toBe('79996')

    // A budget several times the real cost: a shared runner is not a bench,
    // and a test that fails when the machine is busy teaches people to ignore
    // it. What this catches is the change that makes reading quadratic.
    expect(took).toBeLessThan(4000)
  })

  it('writes them back as fast as it read them', () => {
    const sheet = readSheetData(large(20_000))
    const started = performance.now()
    const written = writeSheetData(sheet)

    expect(performance.now() - started).toBeLessThan(4000)
    expect(written.length).toBeGreaterThan(1_000_000)
  })
})

/**
 * The cell that carries a style and nothing else.
 *
 * `<c r="A1" s="1"/>` is in nearly every sheet anybody has — a column that was
 * formatted before it was filled in — and for as long as the scanner's pattern
 * let a greedy `[^>]*` eat the closing slash, every cell after one of them was
 * swallowed and its value handed to the empty cell that swallowed it. A string
 * came back as a number, in a different column, on screen as well as on save.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/2
 */
describe('a cell that closes itself', () => {
  const ROW =
    '<worksheet><sheetData><row r="1" spans="1:4">' +
    '<c r="A1" s="1"/><c r="B1" s="2"/><c r="C1" s="3" t="s"><v>0</v></c><c r="D1" s="4"><v>42</v></c>' +
    '</row></sheetData></worksheet>'

  it('leaves the cells after it where they were', () => {
    const sheet = readSheetData(ROW)

    expect(rowsWithCells(sheet)).toEqual([0])
    expect(cellsOfRow(sheet, 0).map((cell) => cell.column)).toEqual([0, 1, 2, 3])
  })

  it('keeps its own style and stays empty', () => {
    const cell = at(readSheetData(ROW), 'A1')

    expect(cell?.style).toBe(1)
    expect(cell?.value).toBeNull()
  })

  it('does not take the value of the next cell, or lose its type', () => {
    const sheet = readSheetData(ROW)

    expect(at(sheet, 'C1')?.type).toBe('s')
    expect(at(sheet, 'C1')?.value).toBe('0')
    expect(at(sheet, 'D1')?.value).toBe('42')
  })

  it('writes back what it read', () => {
    const sheet = readSheetData(ROW)
    const written = writeSheetData(sheet)

    expect(written).toContain('<c r="A1" s="1"/>')
    expect(written).toContain('<c r="C1" s="3" t="s"><v>0</v></c>')
    expect(written).toContain('<c r="D1" s="4"><v>42</v></c>')
  })

  it('does the same for a row that exists only for its height', () => {
    const sheet = readSheetData(
      '<worksheet><sheetData>' +
        '<row r="1" ht="30" customHeight="1"/><row r="2"><c r="A2"><v>1</v></c></row>' +
        '</sheetData></worksheet>',
    )

    expect(rowsWithCells(sheet)).toEqual([1])
    expect(sheet.properties.get(0)?.height).toBe(30)
    expect(at(sheet, 'A2')?.value).toBe('1')
  })

  it('does the same for a shared formula stated without a body', () => {
    const sheet = readSheetData(
      '<worksheet><sheetData><row r="1">' +
        '<c r="A1"><f t="shared" ref="A1:A2" si="0">B1*2</f><v>2</v></c></row>' +
        '<row r="2"><c r="A2"><f t="shared" si="0"/><v>4</v></c></row>' +
        '</sheetData></worksheet>',
    )

    expect(at(sheet, 'A2')?.formula?.kind).toBe('shared')
    expect(at(sheet, 'A2')?.value).toBe('4')
  })
})

/**
 * What an `<f>` says that this does not model.
 *
 * `ca="1"` marks a formula as always-calculate: a workbook whose `OFFSET` or
 * `INDIRECT` lost it is one that stops refreshing. Thirteen files of the full
 * corpus, and the same answer as everywhere else — carry it.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/16
 */
describe('a formula with more on it than we model', () => {
  const sheet = (formula: string) =>
    `<worksheet><sheetData><row r="1"><c r="A1">${formula}<v>1</v></c></row></sheetData></worksheet>`

  it('carries ca through a round-trip', () => {
    const read = readSheetData(sheet('<f ca="1">OFFSET(B1,0,0)</f>'))
    const cell = at(read, 'A1')

    expect(cell?.formula?.carried).toEqual({ ca: '1' })
    expect(writeSheetData(read)).toContain('ca="1"')
  })

  it('keeps the formula itself, and the attributes it does model', () => {
    const read = readSheetData(sheet('<f t="array" ref="A1:A2" ca="1">ROW(A1:A2)</f>'))
    const written = writeSheetData(read)

    expect(written).toContain('t="array"')
    expect(written).toContain('ref="A1:A2"')
    expect(written).toContain('ca="1"')
    expect(written).toContain('ROW(A1:A2)')
  })

  it('carries nothing when there is nothing to carry', () => {
    expect(at(readSheetData(sheet('<f>B1*2</f>')), 'A1')?.formula?.carried).toBeNull()
  })
})
