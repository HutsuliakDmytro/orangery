import { describe, expect, it } from 'vitest'
import { DEFAULT_PAGE, paperSize, printArea, printTitles, readPageSetup } from './page'

/**
 * How a sheet is meant to come out of a printer.
 *
 * Nothing about a spreadsheet says where its pages end — it is one plane of
 * cells — so every one of these settings exists to answer that.
 */

const sheet = (inside: string) =>
  `<?xml version="1.0"?><worksheet><sheetData/>${inside}</worksheet>`

describe('reading what a sheet says about printing', () => {
  it('gives a sheet that says nothing the defaults Excel gives it', () => {
    expect(readPageSetup(sheet(''))).toEqual(DEFAULT_PAGE)
  })

  it('reads the paper, the way round and the scale', () => {
    const set = readPageSetup(
      sheet('<pageSetup paperSize="9" orientation="landscape" scale="80"/>'),
    )

    expect(set).toMatchObject({ paper: 9, landscape: true, scale: 80 })
  })

  it('reads a fit to so many pages, and nought as no fit at all', () => {
    // A sheet nought pages wide is not a thing; the file writes it to mean
    // "as many as it takes".
    const fitted = readPageSetup(sheet('<pageSetup fitToWidth="1" fitToHeight="0"/>'))

    expect(fitted.fitToWidth).toBe(1)
    expect(fitted.fitToHeight).toBeNull()
  })

  it('knows whether the fitting is used at all', () => {
    // Stated somewhere else entirely, which is why a sheet can carry a
    // `fitToWidth` it is not using.
    expect(readPageSetup(sheet('<pageSetup fitToWidth="1"/>')).fitToPage).toBe(false)
    expect(
      readPageSetup(sheet('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><pageSetup/>')).fitToPage,
    ).toBe(true)
  })

  it('reads the margins in the inches the file keeps them in', () => {
    const set = readPageSetup(sheet('<pageMargins left="1" right="1" top="0.5" bottom="0.5"/>'))

    expect(set.margins).toMatchObject({ left: 1, right: 1, top: 0.5, bottom: 0.5 })
  })

  it('reads what else goes on the page', () => {
    const set = readPageSetup(
      sheet('<printOptions gridLines="1" headings="1" horizontalCentered="1"/>'),
    )

    expect(set).toMatchObject({ gridLines: true, headings: true, centreHorizontally: true })
  })
})

describe('the size of the paper', () => {
  it('turns it round for a landscape page', () => {
    expect(paperSize(9, false)).toEqual({ width: 595, height: 842 })
    expect(paperSize(9, true)).toEqual({ width: 842, height: 595 })
  })

  it('falls back to A4 for a paper nobody here has heard of', () => {
    // Wrong for somebody in America, and less wrong than refusing to print.
    expect(paperSize(255, false)).toEqual({ width: 595, height: 842 })
  })
})

describe('the print area and the repeated titles', () => {
  const names = [
    { name: '_xlnm.Print_Area', formula: 'Sheet1!$A$1:$D$20', sheet: 0 },
    { name: '_xlnm.Print_Titles', formula: 'Sheet1!$1:$1', sheet: 0 },
    { name: 'Sales', formula: 'Sheet1!$A$1:$A$9', sheet: null },
  ]

  it('finds them among the workbook names, scoped to the sheet', () => {
    // Excel keeps both as defined names rather than in the sheet, which is
    // why they are looked for here rather than there.
    expect(printArea(names, 0)).toBe('Sheet1!$A$1:$D$20')
    expect(printTitles(names, 0)).toBe('Sheet1!$1:$1')
  })

  it('says nothing for a sheet that states neither', () => {
    expect(printArea(names, 1)).toBeNull()
    expect(printTitles(names, 1)).toBeNull()
  })
})
