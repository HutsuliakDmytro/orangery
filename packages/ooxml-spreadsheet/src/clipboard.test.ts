import { describe, expect, it } from 'vitest'
import {
  blockFromHtml,
  blockFromText,
  blockOf,
  blockToHtml,
  blockToText,
  sameSession,
} from './clipboard'
import { readSheetData } from './sheet-data'
import type { Cell } from './cells'

/**
 * Cells on the clipboard.
 *
 * Three readers, three formats, one copy. What is worth stating is that the
 * rich one survives a round trip through this app and that the plain one is
 * readable by everything else — and that a table from somewhere else is not
 * mistaken for ours, which is how a paste ends up full of somebody's markup.
 */

const SHEET =
  '<worksheet xmlns="x"><sheetData>' +
  '<row r="1"><c r="A1" t="inlineStr"><is><t>Month</t></is></c>' +
  '<c r="B1" s="2"><v>1234.5</v></c></row>' +
  '<row r="2"><c r="A2" t="inlineStr"><is><t>January</t></is></c>' +
  '<c r="B2" s="2"><f>A2</f><v>7</v></c></row>' +
  '</sheetData></worksheet>'

const cells = () => readSheetData(SHEET)

const range = (from: { row: number; column: number }, to: { row: number; column: number }) => ({
  sheet: null,
  from,
  to,
})

/** What a cell reads as, which the caller decides and the clipboard asks for. */
const shown = (cell: Cell | null): string => cell?.value ?? ''

describe('lifting a rectangle out of a sheet', () => {
  it('takes the shape it was asked for, holes and all', () => {
    const block = blockOf(cells(), range({ row: 0, column: 0 }, { row: 2, column: 1 }))

    expect(block).toMatchObject({ rows: 3, columns: 2, origin: { row: 0, column: 0 } })
    // The third row was never there; a null says so, where a blank cell would
    // have said something else.
    expect(block.cells[2]).toEqual([null, null])
  })

  it('reads a range written backwards the same way', () => {
    const block = blockOf(cells(), range({ row: 1, column: 1 }, { row: 0, column: 0 }))
    expect(block).toMatchObject({ rows: 2, columns: 2, origin: { row: 0, column: 0 } })
  })
})

describe('what the rest of a computer reads', () => {
  it('is tabs between the columns and newlines between the rows', () => {
    const block = blockOf(cells(), range({ row: 0, column: 0 }, { row: 1, column: 1 }))

    expect(blockToText(block, shown)).toBe('Month\t1234.5\nJanuary\t7')
  })

  it('puts a space where a value had a tab, rather than a second column', () => {
    // The format has no escape; a value that broke the grid apart would be
    // worse than one missing a tab.
    const block = blockOf(cells(), range({ row: 0, column: 0 }, { row: 0, column: 0 }))
    expect(blockToText(block, () => 'a\tb\nc')).toBe('a b c')
  })
})

describe('what this app reads', () => {
  it('comes back as the cells that went in, formulas and all', () => {
    const block = blockOf(cells(), range({ row: 0, column: 0 }, { row: 1, column: 1 }))
    const back = blockFromHtml(blockToHtml(block, shown))

    expect(back?.cells[1]?.[1]).toMatchObject({ value: '7', style: 2 })
    expect(back?.cells[1]?.[1]?.formula?.text).toBe('A2')
  })

  it('travels beside a table the rest of the world can see', () => {
    const block = blockOf(cells(), range({ row: 0, column: 0 }, { row: 0, column: 1 }))
    const html = blockToHtml(block, shown)

    expect(html).toContain('<td>Month</td>')
    expect(html).toContain('<td>1234.5</td>')
  })

  it('escapes a value that would otherwise be markup', () => {
    const block = blockOf(cells(), range({ row: 0, column: 0 }, { row: 0, column: 0 }))
    expect(blockToHtml(block, () => '<b>&')).toContain('<td>&lt;b&gt;&amp;</td>')
  })

  it('survives letters outside Latin-1', () => {
    const block = blockOf(cells(), range({ row: 0, column: 0 }, { row: 0, column: 0 }))
    const back = blockFromHtml(
      blockToHtml(
        {
          ...block,
          cells: [
            [
              {
                row: 0,
                column: 0,
                type: 'inlineStr',
                value: 'Січень',
                style: null,
                formula: null,
                rich: null,
                carried: null,
              },
            ],
          ],
        },
        shown,
      ),
    )

    expect(back?.cells[0]?.[0]?.value).toBe('Січень')
  })

  it('says a copy from this window is from this window', () => {
    const block = blockOf(cells(), range({ row: 0, column: 0 }, { row: 0, column: 0 }))
    const back = blockFromHtml(blockToHtml(block, shown))

    expect(back === null ? false : sameSession(back)).toBe(true)
  })

  it('says a copy from somewhere else is not', () => {
    // Which is what stops a style index meaning one thing here and another
    // there.
    const block = blockOf(cells(), range({ row: 0, column: 0 }, { row: 0, column: 0 }))
    const html = blockToHtml({ ...block, session: 'another-window' }, shown)

    expect(sameSession(blockFromHtml(html) ?? block)).toBe(false)
  })
})

describe('a table from somewhere else', () => {
  it('is not mistaken for ours', () => {
    expect(blockFromHtml('<table><tr><td>Month</td></tr></table>')).toBeNull()
  })

  it('is not read from markup that lost its payload on the way', () => {
    expect(blockFromHtml('<table data-orangery-cells="not base64 at all"></table>')).toBeNull()
  })
})

describe('tab-separated text coming in', () => {
  it('becomes a block of the shape the text describes', () => {
    const block = blockFromText('a\tb\nc\td', { row: 2, column: 3 })

    expect(block).toMatchObject({ rows: 2, columns: 2, origin: { row: 2, column: 3 } })
    expect(block.cells[0]?.[1]).toMatchObject({ value: 'b', row: 2, column: 4 })
  })

  it('ignores the newline most programs put at the end', () => {
    // Taking it as a row would paste a blank line under everything.
    expect(blockFromText('a\nb\n', { row: 0, column: 0 })).toMatchObject({ rows: 2 })
  })

  it('squares off a ragged table with nothing rather than with blanks', () => {
    const block = blockFromText('a\tb\tc\nd', { row: 0, column: 0 })

    expect(block.columns).toBe(3)
    expect(block.cells[1]).toEqual([expect.objectContaining({ value: 'd' }), null, null])
  })

  it('reads Windows line endings as line endings', () => {
    expect(blockFromText('a\r\nb', { row: 0, column: 0 })).toMatchObject({ rows: 2 })
  })
})
