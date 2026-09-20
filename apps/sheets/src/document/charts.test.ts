import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { getPartText, parseRelationships, readPackage } from '@orangery/ooxml-core'
import { readSheetDrawings } from '@orangery/ooxml-spreadsheet'
import { readChart } from '@orangery/charts'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { chartDataFrom, insertChart, insertPicture, refreshCharts } from './charts'
import { workbookBytes } from './save'

/**
 * A chart made from cells on a sheet.
 *
 * Four parts have to agree before one appears: the chart, the drawing that
 * positions it, the relationships between them and the content types that
 * say what each one is. What is tested is that they do — a file where any of
 * the four disagrees is a file Excel offers to repair, and nothing short of
 * reading it all back says so.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let open: OpenWorkbook
let sheet: OpenSheet

/** A block of the fixture with names down one column and numbers beside it. */
const range = { anchor: { row: 2, column: 0 }, focus: { row: 5, column: 1 } }

beforeEach(async () => {
  open = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
  const first = open.sheets[0]
  if (first === undefined) throw new Error('the fixture has no sheets')
  sheet = first
})

describe('reading a range as a chart would', () => {
  it('takes the first column as the names and the rest as series', () => {
    const read = chartDataFrom(open, sheet, range)

    expect(read?.data.categories).toHaveLength(4)
    expect(read?.data.series).toHaveLength(1)
    expect(read?.data.series[0]?.values).toHaveLength(4)
  })

  it('names the cells it came from, sheet and all', () => {
    const read = chartDataFrom(open, sheet, range)

    expect(read?.source.categories).toContain(`${sheet.name}!$A$`)
    expect(read?.source.series[0]?.values).toContain(`${sheet.name}!$B$`)
  })

  it('refuses a range that is not a table', () => {
    // One column is a list of numbers with nothing to call them; one row is
    // a single point. Neither is a chart.
    expect(
      chartDataFrom(open, sheet, { anchor: { row: 2, column: 0 }, focus: { row: 5, column: 0 } }),
    ).toBeNull()
    expect(
      chartDataFrom(open, sheet, { anchor: { row: 2, column: 0 }, focus: { row: 2, column: 3 } }),
    ).toBeNull()
  })
})

describe('putting one on the sheet', () => {
  it('shows it at once, before anything is saved', () => {
    const before = sheet.drawings.length
    const added = insertChart(open, sheet, range, 'bar')

    expect(added).not.toBeNull()
    expect(sheet.drawings).toHaveLength(before + 1)
    expect(added?.drawing.content.kind).toBe('chart')
  })

  it('writes a chart that points at the cells rather than at a workbook', () => {
    const added = insertChart(open, sheet, range, 'bar')
    const chart = readChart(getPartText(open.pkg, added?.path ?? '') ?? '')
    if (chart === null) throw new Error('the chart part could not be read')

    expect(chart.plots[0]?.series[0]?.valuesRef).toContain(`${sheet.name}!$B$`)
    expect(getPartText(open.pkg, added?.path ?? '')).not.toContain('externalData')
  })

  it('makes the four parts agree with each other', async () => {
    insertChart(open, sheet, range, 'line')
    const saved = await readPackage(await workbookBytes(open, { edited: true }), 'xl/workbook.xml')

    // The sheet names a drawing, the drawing names a chart, and the content
    // types know what both of them are.
    const sheetXml = getPartText(saved, sheet.path) ?? ''
    expect(sheetXml).toContain('<drawing r:id=')

    const sheetRels = parseRelationships(
      getPartText(saved, 'xl/worksheets/_rels/sheet1.xml.rels') ?? '',
    )
    const drawing = [...sheetRels.values()].find((one) => one.type.endsWith('/drawing'))
    expect(drawing).toBeDefined()

    const drawings = readSheetDrawings(getPartText(saved, 'xl/drawings/drawing1.xml') ?? '')
    expect(drawings.some((one) => one.content.kind === 'chart')).toBe(true)

    const types = getPartText(saved, '[Content_Types].xml') ?? ''
    expect(types).toContain('chart+xml')
  })

  it('puts a second chart in the drawing the first one made', () => {
    // A second part would be a second list Excel would not look at.
    insertChart(open, sheet, range, 'bar')
    insertChart(open, sheet, range, 'pie')

    const parts = [...open.pkg.parts.keys()].filter((path) => path.startsWith('xl/drawings/'))
    expect(parts.filter((path) => path.endsWith('.xml'))).toHaveLength(1)
    expect(readSheetDrawings(getPartText(open.pkg, 'xl/drawings/drawing1.xml') ?? '')).toHaveLength(
      sheet.drawings.length,
    )
  })
})

describe('putting a picture on the sheet', () => {
  /** The smallest PNG there is: one pixel, and a header that says so. */
  const png = () =>
    Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0x00, 0x00, 0x00, 0x60, 0x00, 0x00, 0x00, 0x40, 0x08, 0x06, 0x00, 0x00, 0x00,
    ])

  it('shows it at once, at the size the image says it is', () => {
    const added = insertPicture(open, sheet, { row: 2, column: 2 }, { name: 'a.png', bytes: png() })

    expect(added?.drawing.content.kind).toBe('picture')
    // Ninety-six pixels wide at ninety-six to the inch is one inch, which is
    // seventy-two points.
    expect(added?.drawing.anchor.kind === 'one' ? added.drawing.anchor.width : 0).toBe(72 * 12_700)
  })

  it('puts the bytes in the package with a relationship to them', () => {
    const added = insertPicture(open, sheet, { row: 0, column: 0 }, { name: 'a.png', bytes: png() })

    expect(open.pkg.parts.has(added?.path ?? '')).toBe(true)
    expect(getPartText(open.pkg, '[Content_Types].xml')).toContain('image/png')
  })

  it('refuses bytes nothing here can read as a picture', () => {
    expect(
      insertPicture(open, sheet, { row: 0, column: 0 }, { name: 'notes.txt', bytes: png() }),
    ).toBeNull()
  })
})

describe('keeping a chart in step with its cells', () => {
  it('redraws it from the numbers as they now stand', () => {
    // The whole reason a chart on a sheet differs from one in a document:
    // its numbers are somebody else's, and when they change it changes.
    const added = insertChart(open, sheet, range, 'bar')
    const before = readChart(getPartText(open.pkg, added?.path ?? '') ?? '')
    const first = before?.plots[0]?.series[0]?.values[0] ?? null

    const cell = sheet.cells.rows.get(3)?.get(1)
    if (cell === undefined) throw new Error('the fixture has no cell there')
    sheet.cells.rows.get(3)?.set(1, { ...cell, type: 'n', value: '9999' })

    expect(refreshCharts(open, [sheet.path])).toEqual([sheet.path])

    const after = readChart(getPartText(open.pkg, added?.path ?? '') ?? '')
    expect(after?.plots[0]?.series[0]?.values).toContain(9999)
    expect(after?.plots[0]?.series[0]?.values[0]).not.toBe(null)
    expect(first).not.toBe(9999)
  })

  it('leaves alone a chart whose sheet nothing happened on', () => {
    const added = insertChart(open, sheet, range, 'bar')
    const before = getPartText(open.pkg, added?.path ?? '')

    expect(refreshCharts(open, ['xl/worksheets/sheet9.xml'])).toEqual([])
    expect(getPartText(open.pkg, added?.path ?? '')).toBe(before)
  })
})
