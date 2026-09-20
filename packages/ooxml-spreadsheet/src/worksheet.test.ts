import { describe, expect, it } from 'vitest'
import { isColumnHidden, mergeAt, readWorksheet, widthOfColumn } from './worksheet'

/**
 * The worksheet around its cells.
 *
 * Everything the grid has to know before it draws one: how wide the columns
 * are, what is frozen, what is merged with what, and what the sheet says about
 * itself when it says nothing.
 */

const SHEET =
  '<worksheet xmlns="x"><sheetPr><tabColor rgb="FFFF7A00"/></sheetPr>' +
  '<dimension ref="A1:F40"/>' +
  '<sheetViews><sheetView tabSelected="1" zoomScale="125" showGridLines="0" workbookViewId="0">' +
  '<pane xSplit="1" ySplit="2" topLeftCell="B3" activePane="bottomRight" state="frozen"/>' +
  '<selection pane="bottomRight" activeCell="C5" sqref="C5"/></sheetView></sheetViews>' +
  '<sheetFormatPr defaultRowHeight="15" defaultColWidth="8.7"/>' +
  '<cols><col min="1" max="1" width="24.5" customWidth="1"/>' +
  '<col min="3" max="5" hidden="1" width="0"/></cols>' +
  '<sheetData/>' +
  '<autoFilter ref="A1:F1"/>' +
  '<mergeCells count="2"><mergeCell ref="A1:C1"/><mergeCell ref="E2:E4"/></mergeCells>' +
  '</worksheet>'

const sheet = () => {
  const read = readWorksheet(SHEET)
  if (read === null) throw new Error('the part holds no worksheet')
  return read
}

describe('what a sheet says about itself', () => {
  it('reads how far it claims to reach', () => {
    // A hint rather than a fact: Excel writes it and nothing enforces it.
    expect(sheet().dimension?.to).toEqual({ row: 39, column: 5 })
  })

  it('reads the zoom and whether the lines are drawn', () => {
    expect(sheet().view.zoom).toBe(125)
    expect(sheet().view.showGridLines).toBe(false)
  })

  it('shows the lines when the sheet says nothing, which is the common case', () => {
    // Absence means yes here; a reader that treated it as no would draw every
    // ordinary sheet without gridlines.
    const bare = readWorksheet('<worksheet xmlns="x"><sheetData/></worksheet>')

    expect(bare?.view.showGridLines).toBe(true)
    expect(bare?.view.zoom).toBe(100)
  })

  it('reads frozen panes as the rows and columns they hold still', () => {
    expect(sheet().view.panes).toEqual({ columns: 1, rows: 2, split: false })
  })

  it('tells a split from a freeze, which are one element apart', () => {
    const split = readWorksheet(
      '<worksheet xmlns="x"><sheetViews><sheetView><pane xSplit="2000" ySplit="1000"/>' +
        '</sheetView></sheetViews><sheetData/></worksheet>',
    )

    expect(split?.view.panes?.split).toBe(true)
  })

  it('reads no panes where the sheet freezes nothing', () => {
    const none = readWorksheet(
      '<worksheet xmlns="x"><sheetViews><sheetView><pane xSplit="0" ySplit="0"/>' +
        '</sheetView></sheetViews><sheetData/></worksheet>',
    )

    expect(none?.view.panes).toBeNull()
  })

  it('remembers where the cursor was left', () => {
    expect(sheet().view.selection).toBe('C5')
  })

  it('reads the colour of the tab', () => {
    expect(sheet().tabColor).toBe('FFFF7A00')
  })

  it('reads the range an autofilter covers', () => {
    expect(sheet().autoFilter?.range.to).toEqual({ row: 0, column: 5 })
  })

  it('reads arrows with nothing filtered as arrows with nothing filtered', () => {
    // The ordinary state of a table somebody has turned filtering on for.
    expect(sheet().autoFilter?.columns).toEqual([])
  })
})

describe('columns', () => {
  it('reads a width as the file states it, in characters', () => {
    // Not converted: what a character is depends on the font the workbook was
    // written with, and a guess makes every column a little wrong.
    expect(widthOfColumn(sheet(), 0)).toBe(24.5)
  })

  it('falls back to the sheet default where a column states none', () => {
    expect(widthOfColumn(sheet(), 1)).toBe(8.7)
  })

  it('reads a run of hidden columns as hidden, all of them', () => {
    const one = sheet()

    expect(isColumnHidden(one, 2)).toBe(true)
    expect(isColumnHidden(one, 4)).toBe(true)
    expect(isColumnHidden(one, 5)).toBe(false)
  })

  it('counts columns from zero, as the model does everywhere', () => {
    expect(sheet().columns[0]).toMatchObject({ from: 0, to: 0 })
    expect(sheet().columns[1]).toMatchObject({ from: 2, to: 4 })
  })
})

describe('merged cells', () => {
  it('finds the merge a cell belongs to', () => {
    const one = sheet()

    expect(mergeAt(one, { row: 0, column: 1 })?.from).toEqual({ row: 0, column: 0 })
    expect(mergeAt(one, { row: 2, column: 4 })?.to).toEqual({ row: 3, column: 4 })
  })

  it('finds nothing for a cell in no merge, which is most of them', () => {
    expect(mergeAt(sheet(), { row: 10, column: 10 })).toBeNull()
  })

  it('reads every merge the sheet states', () => {
    expect(sheet().merges).toHaveLength(2)
  })
})

describe('a part that is not a worksheet', () => {
  it('is read as nothing rather than as an empty sheet', () => {
    expect(readWorksheet('<workbook/>')).toBeNull()
    expect(readWorksheet('')).toBeNull()
  })
})
