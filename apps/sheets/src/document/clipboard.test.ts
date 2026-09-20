import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { blockFromHtml, blockOf, blockToHtml, cellAt } from '@orangery/ooxml-spreadsheet'
import type { CellBlock } from '@orangery/ooxml-spreadsheet'
import { singleCell } from '@orangery/grid'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { blockFrom, copiedFrom, pasteBlock, pastedArea } from './clipboard'
import { shownText } from './shown'

/**
 * Cells copied out and put back.
 *
 * The cases worth stating are the ones where a paste is not a copy of the
 * bytes: a formula moves with it, a block from another window arrives without
 * a style index that would mean something else here, and an empty cell in the
 * block empties the cell it lands on rather than leaving the old value
 * showing through.
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

const at = (row: number, column: number) => cellAt(sheet.cells, { row, column })

const copied = (from: { row: number; column: number }, to: { row: number; column: number }) =>
  blockOf(sheet.cells, { sheet: null, from, to })

describe('what a copy carries', () => {
  it('is the value somebody was looking at, not the one the file keeps', () => {
    // C2 holds 45292 with a date format on it.
    const text = copiedFrom(
      sheet,
      {
        ranges: [{ anchor: { row: 1, column: 2 }, focus: { row: 1, column: 2 } }],
        active: { row: 1, column: 2 },
      },
      (cell) => shownText(open, cell),
    ).text

    expect(text).toBe('01-01-24')
  })

  it('is the last range when several are selected', () => {
    // Excel refuses a copy of several ranges that are not the same shape; the
    // one chosen last is the one somebody was looking at.
    const text = copiedFrom(
      sheet,
      {
        ranges: [
          { anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } },
          { anchor: { row: 1, column: 1 }, focus: { row: 1, column: 1 } },
        ],
        active: { row: 1, column: 1 },
      },
      (cell) => shownText(open, cell),
    ).text

    expect(text).toBe('1,234.50')
  })
})

describe('putting a block back', () => {
  it('lands where it is told, with the values it left with', () => {
    const block = copied({ row: 0, column: 0 }, { row: 1, column: 1 })
    pasteBlock(sheet, block, { row: 8, column: 5 })

    expect(at(8, 5)?.value).toBe(at(0, 0)?.value)
    expect(at(9, 6)?.value).toBe('1234.5')
  })

  it('moves a formula by as far as the block moved', () => {
    // C4 holds `B2+B3`, and two rows down it has to mean `B4+B5`.
    const block = copied({ row: 3, column: 2 }, { row: 3, column: 2 })
    pasteBlock(sheet, block, { row: 5, column: 2 })

    expect(at(5, 2)?.formula?.text).toBe('B4+B5')
  })

  it('empties what it lands on where the block has a hole', () => {
    // A copied block is a rectangle; pasting it leaving holes would leave the
    // old values showing through it.
    const empty = copied({ row: 8, column: 5 }, { row: 8, column: 5 })
    pasteBlock(sheet, empty, { row: 1, column: 1 })

    expect(at(1, 1)).toBeNull()
  })

  it('says what it changed, so one paste is one thing to take back', () => {
    const block = copied({ row: 0, column: 0 }, { row: 1, column: 1 })
    const changes = pasteBlock(sheet, block, { row: 8, column: 5 })

    expect(changes).toHaveLength(4)
    expect(changes[0]).toMatchObject({ sheet: sheet.path, before: null })
  })

  it('keeps the style of a block from this window', () => {
    const block = copied({ row: 1, column: 1 }, { row: 1, column: 1 })
    pasteBlock(sheet, block, { row: 8, column: 5 })

    expect(at(8, 5)?.style).toBe(at(1, 1)?.style)
  })

  it('drops the style of a block from another one', () => {
    // A style is an index into the workbook it came from, and the same index
    // here is a different style; the target keeps the look it already had.
    const block = copied({ row: 1, column: 1 }, { row: 1, column: 1 })
    const elsewhere: CellBlock = { ...block, session: 'another-window' }

    pasteBlock(sheet, elsewhere, { row: 2, column: 2 })

    // C3 showed a percentage before, and still does.
    expect(at(2, 2)?.style).toBe(4)
    expect(at(2, 2)?.value).toBe('1234.5')
  })
})

describe('what the clipboard was holding', () => {
  it('is read as ours when it is ours', () => {
    const html = blockToHtml(copied({ row: 0, column: 0 }, { row: 0, column: 1 }), (cell) =>
      shownText(open, cell),
    )
    const block = blockFrom({ html, text: 'ignored\tentirely' }, { row: 0, column: 0 })

    expect(block?.cells[0]?.[0]?.type).toBe('s')
  })

  it('falls back to the text when the markup is somebody else’s', () => {
    const block = blockFrom(
      { html: '<table><tr><td>a</td></tr></table>', text: 'a\tb' },
      { row: 4, column: 4 },
    )

    expect(block).toMatchObject({ rows: 1, columns: 2 })
    expect(block?.cells[0]?.[1]?.value).toBe('b')
  })

  it('is nothing at all when the clipboard is empty', () => {
    expect(blockFrom({ html: null, text: null }, { row: 0, column: 0 })).toBeNull()
    expect(blockFrom({ html: null, text: '' }, { row: 0, column: 0 })).toBeNull()
  })
})

describe('a copy that goes round the whole way', () => {
  it('leaves the sheet as it found it', () => {
    const before = at(1, 1)
    const html = blockToHtml(copied({ row: 1, column: 1 }, { row: 1, column: 1 }), (cell) =>
      shownText(open, cell),
    )

    const block = blockFromHtml(html)
    if (block === null) throw new Error('the clipboard lost the block')

    pasteBlock(sheet, block, { row: 1, column: 1 })

    expect(at(1, 1)).toEqual(before)
  })

  it('does the same for a single cell chosen with the keyboard', () => {
    const selection = singleCell({ row: 0, column: 0 })
    const { html } = copiedFrom(sheet, selection, (cell) => shownText(open, cell))
    const block = blockFrom({ html, text: null }, { row: 0, column: 0 })

    expect(block).toMatchObject({ rows: 1, columns: 1 })
  })
})

describe('a paste that is not the whole cell', () => {
  it('takes the number and leaves the sum that made it', () => {
    // Which is what everybody uses "values" for: freezing a result so it
    // stops moving when the rows under it change.
    const block = copied({ row: 3, column: 2 }, { row: 3, column: 2 })
    pasteBlock(sheet, block, { row: 8, column: 5 }, { what: 'values', transpose: false })

    expect(at(8, 5)?.formula).toBeNull()
    expect(at(8, 5)?.value).toBe(at(3, 2)?.value)
  })

  it('leaves the look of what it lands on alone', () => {
    const block = copied({ row: 1, column: 1 }, { row: 1, column: 1 })
    const was = at(2, 2)?.style

    pasteBlock(sheet, block, { row: 2, column: 2 }, { what: 'values', transpose: false })
    expect(at(2, 2)?.style).toBe(was)
  })

  it('takes the look and leaves the value, the other way about', () => {
    const block = copied({ row: 1, column: 1 }, { row: 1, column: 1 })
    const value = at(2, 2)?.value

    pasteBlock(sheet, block, { row: 2, column: 2 }, { what: 'formats', transpose: false })

    expect(at(2, 2)?.style).toBe(at(1, 1)?.style)
    expect(at(2, 2)?.value).toBe(value)
  })

  it('can put a look on a cell that has nothing in it', () => {
    const block = copied({ row: 1, column: 1 }, { row: 1, column: 1 })
    pasteBlock(sheet, block, { row: 8, column: 5 }, { what: 'formats', transpose: false })

    expect(at(8, 5)?.style).toBe(at(1, 1)?.style)
    expect(at(8, 5)?.value).toBeNull()
  })
})

describe('a block turned on its side', () => {
  it('puts the first row down the first column', () => {
    const block = copied({ row: 0, column: 0 }, { row: 0, column: 2 })
    pasteBlock(sheet, block, { row: 10, column: 5 }, { what: 'all', transpose: true })

    expect(at(10, 5)?.value).toBe(at(0, 0)?.value)
    expect(at(12, 5)?.value).toBe(at(0, 2)?.value)
  })

  it('says how much room it takes, which is the other way round', () => {
    const block = copied({ row: 0, column: 0 }, { row: 2, column: 0 })

    expect(pastedArea(block, { what: 'all', transpose: true })).toEqual({ rows: 1, columns: 3 })
  })
})

describe('a block laid into a bigger selection', () => {
  it('goes down as many times as it fits', () => {
    // One row copied across a week is the gesture; Excel asks for a whole
    // multiple and so does this.
    const block = copied({ row: 0, column: 0 }, { row: 0, column: 0 })
    const changes = pasteBlock(
      sheet,
      block,
      { row: 10, column: 5 },
      {
        what: 'all',
        transpose: false,
        over: { rows: 3, columns: 2 },
      },
    )

    expect(changes).toHaveLength(6)
    expect(at(12, 6)?.value).toBe(at(0, 0)?.value)
  })

  it('moves each copy’s formulas by as far as that copy went', () => {
    const block = copied({ row: 3, column: 2 }, { row: 3, column: 2 })
    pasteBlock(
      sheet,
      block,
      { row: 10, column: 2 },
      {
        what: 'all',
        transpose: false,
        over: { rows: 2, columns: 1 },
      },
    )

    expect(at(10, 2)?.formula?.text).toBe('B9+B10')
    expect(at(11, 2)?.formula?.text).toBe('B10+B11')
  })

  it('is pasted once where the selection is not a whole multiple', () => {
    // Half a block is not something anybody meant.
    const block = copied({ row: 0, column: 0 }, { row: 1, column: 0 })
    const changes = pasteBlock(
      sheet,
      block,
      { row: 10, column: 5 },
      {
        what: 'all',
        transpose: false,
        over: { rows: 3, columns: 1 },
      },
    )

    expect(changes).toHaveLength(2)
  })
})
