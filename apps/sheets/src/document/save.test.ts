import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { compareXml, describeDifferences, getPartText, readPackage } from '@orangery/ooxml-core'
import { cellAt } from '@orangery/ooxml-spreadsheet'
import { openWorkbook } from './workbook'
import { workbookBytes } from './save'

/**
 * A workbook opened and put back.
 *
 * The only claim worth making about a save is that a file nobody touched
 * comes back the same. Not byte for byte — a zip varies in ways nothing can
 * see — but part for part and element for element, including the parts
 * nothing here understands, which is where the value is.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let original: Uint8Array

beforeEach(async () => {
  original = new Uint8Array(await readFile(FIXTURE))
})

/** The workbook, saved and opened again, beside the parts it started with. */
const roundTrip = async (edit?: (open: Awaited<ReturnType<typeof openWorkbook>>) => void) => {
  const before = await readPackage(original, 'xl/workbook.xml')
  const open = await openWorkbook(original)
  edit?.(open)

  const saved = await workbookBytes(open, { edited: edit !== undefined })
  return { before, after: await readPackage(saved, 'xl/workbook.xml') }
}

describe('a workbook saved without being touched', () => {
  it('keeps every part it arrived with', async () => {
    const { before, after } = await roundTrip()

    expect([...after.parts.keys()].sort()).toEqual([...before.parts.keys()].sort())
  })

  it('writes the cells back element for element', async () => {
    const { before, after } = await roundTrip()

    const was = getPartText(before, 'xl/worksheets/sheet1.xml') ?? ''
    const is = getPartText(after, 'xl/worksheets/sheet1.xml') ?? ''

    // Named rather than counted: a difference is worth reading when there is
    // one, and "two differences" tells nobody which two.
    expect(describeDifferences(compareXml(was, is))).toBe('no differences')
  })

  it('leaves the parts it never opened exactly as they were', async () => {
    // The chart, the drawing, the comments, the theme. A save that rebuilt
    // them would rebuild only the parts of them this understands.
    const { before, after } = await roundTrip()

    for (const path of ['xl/charts/chart1.xml', 'xl/drawings/drawing1.xml', 'xl/comments1.xml']) {
      expect(getPartText(after, path)).toBe(getPartText(before, path))
    }
  })

  it('keeps a picture byte for byte, which is not a text part at all', async () => {
    const { before, after } = await roundTrip()

    expect(after.parts.get('xl/media/image1.png')?.bytes).toEqual(
      before.parts.get('xl/media/image1.png')?.bytes,
    )
  })

  it('keeps the calculation chain, which is still true of a file nobody changed', async () => {
    const { after } = await roundTrip()

    expect(after.parts.has('xl/calcChain.xml')).toBe(true)
    expect(getPartText(after, '[Content_Types].xml')).toContain('/xl/calcChain.xml')
  })

  it('opens again to the same cells it was opened from', async () => {
    const open = await openWorkbook(original)
    const again = await openWorkbook(await workbookBytes(open))

    const was = cellAt(open.sheets[0]?.cells ?? { rows: new Map(), properties: new Map() }, {
      row: 1,
      column: 1,
    })
    const is = cellAt(again.sheets[0]?.cells ?? { rows: new Map(), properties: new Map() }, {
      row: 1,
      column: 1,
    })

    expect(is).toEqual(was)
    expect(again.sheets).toHaveLength(open.sheets.length)
  })
})

describe('a workbook that was edited', () => {
  it('carries the change through into the part', async () => {
    const open = await openWorkbook(original)
    const cell = cellAt(open.sheets[0]?.cells ?? { rows: new Map(), properties: new Map() }, {
      row: 1,
      column: 1,
    })
    if (cell === null) throw new Error('the fixture lost a cell')

    cell.value = '4321'
    const after = await readPackage(await workbookBytes(open, { edited: true }), 'xl/workbook.xml')

    expect(getPartText(after, 'xl/worksheets/sheet1.xml')).toContain('<v>4321</v>')
    expect(getPartText(after, 'xl/worksheets/sheet1.xml')).not.toContain('<v>1234.5</v>')
  })

  it('drops the calculation chain, and the two references to it', async () => {
    // It lists the order Excel last recalculated in; a stale one makes Excel
    // recalculate in the wrong order, or call the file damaged. A part left
    // behind in the content types or the relationships does the same.
    const { after } = await roundTrip((open) => {
      const cell = cellAt(open.sheets[0]?.cells ?? { rows: new Map(), properties: new Map() }, {
        row: 1,
        column: 1,
      })
      if (cell !== null) cell.value = '4321'
    })

    expect(after.parts.has('xl/calcChain.xml')).toBe(false)
    expect(getPartText(after, '[Content_Types].xml')).not.toContain('/xl/calcChain.xml')
    expect(getPartText(after, 'xl/_rels/workbook.xml.rels')).not.toContain('calcChain.xml')
  })

  it('leaves everything around the cells alone', async () => {
    // A merge, a frozen pane, a conditional rule and a drawing reference all
    // live in the same part as the cells and none of them are rebuilt.
    const { after } = await roundTrip((open) => {
      const cell = cellAt(open.sheets[0]?.cells ?? { rows: new Map(), properties: new Map() }, {
        row: 1,
        column: 1,
      })
      if (cell !== null) cell.value = '4321'
    })

    const sheet = getPartText(after, 'xl/worksheets/sheet1.xml') ?? ''

    expect(sheet).toContain('<mergeCell ref="B1:C1"/>')
    expect(sheet).toContain('state="frozen"')
    expect(sheet).toContain('<cfRule type="cellIs"')
    expect(sheet).toContain('<drawing r:id="rId1"/>')
  })
})
