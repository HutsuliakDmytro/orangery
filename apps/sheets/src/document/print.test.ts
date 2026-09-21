import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PAGE } from '@orangery/ooxml-spreadsheet'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { boundsToPrint, pageRule, titleRows } from './print'

/**
 * Where the pages end.
 *
 * A document has pages in it and a deck is a list of them; a spreadsheet is
 * one plane of cells that nothing divides, so everything here exists to
 * answer that one question.
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

describe('the page rule', () => {
  it('states the paper in points, which is what print CSS takes', () => {
    expect(pageRule({ ...DEFAULT_PAGE, paper: 9 })).toContain('size: 595pt 842pt')
  })

  it('turns the paper round for a landscape sheet', () => {
    expect(pageRule({ ...DEFAULT_PAGE, paper: 9, landscape: true })).toContain('size: 842pt 595pt')
  })

  it('turns the margins from inches into points', () => {
    // The file keeps them in inches and CSS will not take one.
    const rule = pageRule({
      ...DEFAULT_PAGE,
      margins: { ...DEFAULT_PAGE.margins, top: 1, right: 0.5, bottom: 1, left: 0.5 },
    })

    expect(rule).toContain('margin: 72pt 36pt 72pt 36pt')
  })
})

describe('what gets printed', () => {
  it('is everything there is, where the workbook says nothing', () => {
    const bounds = boundsToPrint(open, sheet)

    expect(bounds?.top).toBe(0)
    expect(bounds?.bottom ?? 0).toBeGreaterThan(0)
  })

  it('is the print area where the workbook states one', () => {
    // Excel keeps it as a defined name scoped to the sheet, which is why
    // this needs the workbook rather than only the sheet.
    open.workbook.definedNames = [
      { name: '_xlnm.Print_Area', formula: 'Budget!$A$1:$C$5', sheet: 0, hidden: false },
    ]

    expect(boundsToPrint(open, sheet)).toEqual({ top: 0, bottom: 4, left: 0, right: 2 })
  })

  it('is nothing at all for a sheet with no cells in it', () => {
    sheet.cells.rows.clear()
    expect(boundsToPrint(open, sheet)).toBeNull()
  })
})

describe('the rows repeated at the top of every page', () => {
  it('reads them out of the name the workbook keeps them in', () => {
    open.workbook.definedNames = [
      { name: '_xlnm.Print_Titles', formula: 'Budget!$1:$2', sheet: 0, hidden: false },
    ]

    expect(titleRows(open, sheet)).toEqual({ top: 0, bottom: 1 })
  })

  it('says nothing where the sheet repeats nothing', () => {
    expect(titleRows(open, sheet)).toBeNull()
  })
})
