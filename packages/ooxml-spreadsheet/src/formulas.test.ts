import { describe, expect, it } from 'vitest'
import { adjustFormula, shiftFormula } from './formulas'
import { readSheetData, writeSheetData } from './sheet-data'
import { cellAt } from './cells'

/**
 * Formulas written once for many cells.
 *
 * Two questions here and no third one. What does this formula say from a cell
 * three rows down — a question about text, not about arithmetic. And does a
 * file that was read and written again still say what it said, which is the
 * whole promise of the round-trip.
 */

describe('the same formula seen from somewhere else', () => {
  it('moves a plain reference by the distance asked for', () => {
    expect(shiftFormula('SUM(A1:A5)', { rows: 3, columns: 0 })).toBe('SUM(A4:A8)')
    expect(shiftFormula('A1', { rows: 0, columns: 2 })).toBe('C1')
  })

  it('leaves a reference the dollar pins, in whichever direction it pins it', () => {
    expect(shiftFormula('$A$1', { rows: 3, columns: 2 })).toBe('$A$1')
    expect(shiftFormula('$A1', { rows: 3, columns: 2 })).toBe('$A4')
    expect(shiftFormula('A$1', { rows: 3, columns: 2 })).toBe('C$1')
  })

  it('carries the sheet a reference names along with it', () => {
    expect(shiftFormula("'Q1 2026'!B2", { rows: 1, columns: 0 })).toBe("'Q1 2026'!B3")
    expect(shiftFormula('Notes!B2', { rows: 1, columns: 0 })).toBe('Notes!B3')
  })

  it('leaves the words of a string alone, however much they look like cells', () => {
    // A formula that rewrote its own message would say something else.
    expect(shiftFormula('IF(A1="A1 is empty","A1","B2")', { rows: 5, columns: 0 })).toBe(
      'IF(A6="A1 is empty","A1","B2")',
    )
  })

  it('keeps a doubled quote inside a string as part of the string', () => {
    expect(shiftFormula('CONCAT(A1,"say ""A1""")', { rows: 1, columns: 0 })).toBe(
      'CONCAT(A2,"say ""A1""")',
    )
  })

  it('does not mistake a function for a cell', () => {
    // `LOG10` is three letters and a number, which is exactly the shape of a
    // reference; the bracket after it is what says it is not one.
    expect(shiftFormula('LOG10(A1)', { rows: 1, columns: 0 })).toBe('LOG10(A2)')
    expect(shiftFormula('_xlfn.XLOOKUP(A1,B1:B9,C1:C9)', { rows: 1, columns: 0 })).toBe(
      '_xlfn.XLOOKUP(A2,B2:B10,C2:C10)',
    )
  })

  it('does not mistake a longer name for a cell', () => {
    expect(shiftFormula('A1B2+1', { rows: 4, columns: 0 })).toBe('A1B2+1')
    expect(shiftFormula('Tax_2026', { rows: 4, columns: 0 })).toBe('Tax_2026')
  })

  it('leaves the column names inside a structured reference where they are', () => {
    expect(shiftFormula('SUM(Table1[[#Headers],[C1]])', { rows: 9, columns: 0 })).toBe(
      'SUM(Table1[[#Headers],[C1]])',
    )
  })

  it('puts the error Excel puts where a reference falls off the sheet', () => {
    expect(shiftFormula('A1', { rows: -5, columns: 0 })).toBe('#REF!')
    expect(shiftFormula('SUM(A1:B2)', { rows: 0, columns: -3 })).toBe('SUM(#REF!:#REF!)')
  })

  it('changes nothing when asked to move by nothing', () => {
    const text = 'IF($A$1>0,SUM(B1:B9),"")'
    expect(shiftFormula(text, { rows: 0, columns: 0 })).toBe(text)
  })
})

/** A column of sums written the way Excel writes one. */
const SHARED =
  '<worksheet xmlns="x"><sheetData>' +
  '<row r="2"><c r="C2"><f t="shared" ref="C2:C4" si="0">SUM(A2:B2)</f><v>3</v></c></row>' +
  '<row r="3"><c r="C3"><f t="shared" si="0"/><v>7</v></c></row>' +
  '<row r="4"><c r="C4"><f t="shared" si="0"/><v>11</v></c></row>' +
  '</sheetData></worksheet>'

describe('a shared formula, read', () => {
  const sheet = () => readSheetData(SHARED)

  it('gives every cell of the group the formula it actually computes', () => {
    const cells = sheet()

    expect(cellAt(cells, { row: 1, column: 2 })?.formula?.text).toBe('SUM(A2:B2)')
    expect(cellAt(cells, { row: 2, column: 2 })?.formula?.text).toBe('SUM(A3:B3)')
    expect(cellAt(cells, { row: 3, column: 2 })?.formula?.text).toBe('SUM(A4:B4)')
  })

  it('keeps the group, so what was one formula can be written as one again', () => {
    const follower = cellAt(sheet(), { row: 2, column: 2 })?.formula

    expect(follower?.kind).toBe('shared')
    expect(follower?.shared).toBe(0)
    expect(follower?.ref).toBeNull()
  })
})

describe('a shared formula, written back', () => {
  it('goes back to one text and the ids that point at it', () => {
    const written = writeSheetData(readSheetData(SHARED))

    expect(written).toContain('<f t="shared" ref="C2:C4" si="0">SUM(A2:B2)</f>')
    expect(written).toContain('<f t="shared" si="0"/>')
    // A file that grew by a megabyte because somebody opened it.
    expect(written).not.toContain('SUM(A3:B3)')
  })

  it('writes a cell edited out of the group as a formula of its own', () => {
    const cells = readSheetData(SHARED)
    const cell = cellAt(cells, { row: 2, column: 2 })
    if (cell === null) throw new Error('the sheet lost a cell')

    cell.formula = {
      ...(cell.formula ?? { kind: 'normal', shared: null, ref: null }),
      text: 'A3*2',
    }
    const written = writeSheetData(cells)

    // No longer what the group says, so no longer part of it — which is what
    // Excel does to a cell somebody has typed over.
    expect(written).toContain('<f>A3*2</f>')
    expect(written).toContain('<f t="shared" ref="C2:C4" si="0">SUM(A2:B2)</f>')
  })
})

const ARRAY =
  '<worksheet xmlns="x"><sheetData>' +
  '<row r="1"><c r="A1"><f t="array" ref="A1:B2">TRANSPOSE(D1:E2)</f><v>1</v></c>' +
  '<c r="B1"><v>2</v></c></row>' +
  '<row r="2"><c r="A2"><v>3</v></c><c r="B2"><v>4</v></c></row>' +
  '</sheetData></worksheet>'

describe('an array formula', () => {
  it('is the same formula on every cell it covers, not a shifted one', () => {
    // One formula over a range; the cells are its results, not its copies.
    const cells = readSheetData(ARRAY)

    expect(cellAt(cells, { row: 1, column: 1 })?.formula?.text).toBe('TRANSPOSE(D1:E2)')
    expect(cellAt(cells, { row: 1, column: 1 })?.formula?.kind).toBe('array')
  })

  it('is written on the corner cell alone, as the file had it', () => {
    const written = writeSheetData(readSheetData(ARRAY))

    expect(written).toContain('<f t="array" ref="A1:B2">TRANSPOSE(D1:E2)</f>')
    expect([...written.matchAll(/TRANSPOSE/gu)]).toHaveLength(1)
    expect(written).toContain('<c r="B2"><v>4</v></c>')
  })
})

describe('a sheet with nothing shared in it', () => {
  it('comes back exactly as it went in', () => {
    const plain =
      '<worksheet xmlns="x"><sheetData>' +
      '<row r="1"><c r="A1"><f>B1+1</f><v>2</v></c><c r="B1"><v>1</v></c></row>' +
      '</sheetData></worksheet>'

    expect(writeSheetData(readSheetData(plain))).toBe(
      '<sheetData><row r="1"><c r="A1"><f>B1+1</f><v>2</v></c><c r="B1"><v>1</v></c></row>' +
        '</sheetData>',
    )
  })

  it('does not invent a group for a lone shared cell whose master is missing', () => {
    // A file can refer to an id nothing carries; the cell keeps what it has
    // rather than being given a formula nobody wrote.
    const orphan =
      '<worksheet xmlns="x"><sheetData>' +
      '<row r="9"><c r="C9"><f t="shared" si="4"/><v>0</v></c></row></sheetData></worksheet>'

    const written = writeSheetData(readSheetData(orphan))
    expect(written).toContain('<f t="shared" si="4"/>')
  })
})

describe('a formula after rows or columns move under it', () => {
  it('pushes down what was below the insertion and leaves what was above', () => {
    // The formula stays where it is; the sheet under it changes shape.
    expect(adjustFormula('SUM(A1:A9)', { axis: 'row', at: 4, by: 2 })).toBe('SUM(A1:A11)')
    expect(adjustFormula('A1+A9', { axis: 'row', at: 4, by: 2 })).toBe('A1+A11')
  })

  it('moves a pinned reference too, because the cell it is pinned to moved', () => {
    // The dollar has nothing to say here: it pins a reference to a cell, and
    // it is the cell that has been pushed down.
    expect(adjustFormula('$A$9', { axis: 'row', at: 0, by: 1 })).toBe('$A$10')
  })

  it('does the same across, for columns', () => {
    expect(adjustFormula('SUM(A1:D1)', { axis: 'column', at: 1, by: 1 })).toBe('SUM(A1:E1)')
    expect(adjustFormula('A1', { axis: 'column', at: 1, by: 1 })).toBe('A1')
  })

  it('pulls things back when a band is taken away', () => {
    expect(adjustFormula('A9', { axis: 'row', at: 2, by: -3 })).toBe('A6')
    // Above the band, so untouched.
    expect(adjustFormula('A2', { axis: 'row', at: 2, by: -3 })).toBe('A2')
  })

  it('says #REF! for a reference to something that was deleted', () => {
    // The cell it named is gone; answering with whatever moved into its place
    // would be an answer about a different cell.
    expect(adjustFormula('A3', { axis: 'row', at: 2, by: -1 })).toBe('#REF!')
    // Rows 3 and 4 go: the start of the range was one of them, and the end
    // was below them and comes back up.
    expect(adjustFormula('SUM(A3:A5)', { axis: 'row', at: 2, by: -2 })).toBe('SUM(#REF!:A3)')
  })

  it('leaves the words of a string alone, as ever', () => {
    expect(adjustFormula('IF(A9>0,"A9 is big","")', { axis: 'row', at: 0, by: 1 })).toBe(
      'IF(A10>0,"A9 is big","")',
    )
  })

  it('changes nothing when nothing moved', () => {
    expect(adjustFormula('SUM(A1:A9)', { axis: 'row', at: 4, by: 0 })).toBe('SUM(A1:A9)')
  })
})
