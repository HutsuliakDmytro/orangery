import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { getPartText, readPackage } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { allSeries, readChart } from '@orangery/ooxml-drawingml'
import { cellsOf, patchedWorkbook, writeChartCache, writeChartCategories } from './chart-data'
import { readPptxPackage } from './parts'
import { saveDeck } from './save'

/**
 * Changing the numbers a chart draws.
 *
 * A chart says the same thing twice — the cache it is drawn from and the
 * workbook "Edit Data" opens — so every test here asks about both. A chart
 * edited in one of them is a chart whose edit disappears the first time
 * somebody opens the other.
 */

const FIXTURES = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic')
const PART = 'ppt/charts/chart1.xml'

const load = async () => readPptxPackage(await readFile(join(FIXTURES, 'charts.pptx')))

const valuesOf = (pkg: OoxmlPackage) => {
  const chart = readChart(getPartText(pkg, PART) ?? '')
  return chart === null ? [] : allSeries(chart).map((series) => series.values)
}

/** The embedded workbook's first sheet, as text. */
async function sheetOf(pkg: OoxmlPackage): Promise<string> {
  const bytes = pkg.parts.get('ppt/embeddings/Microsoft_Excel_Sheet1.xlsx')?.bytes
  if (bytes === undefined) throw new Error('the fixture has no workbook')

  const book = await readPackage(bytes)
  return getPartText(book, 'xl/worksheets/sheet1.xml') ?? ''
}

describe('reading a range', () => {
  it('lists the cells down a column', () => {
    expect(cellsOf('Sheet1!$B$2:$B$5')).toEqual({
      sheet: 'Sheet1',
      cells: ['B2', 'B3', 'B4', 'B5'],
    })
  })

  it('reads a single cell as a range of one, which is how a name is written', () => {
    expect(cellsOf('Sheet1!$B$1')).toEqual({ sheet: 'Sheet1', cells: ['B1'] })
  })

  it('reads a sheet whose name is quoted', () => {
    expect(cellsOf("'My Data'!$A$1:$A$2")?.sheet).toBe('My Data')
  })

  it('says nothing about a formula it does not understand', () => {
    expect(cellsOf('SUM(A1:A5)')).toBeNull()
  })
})

describe('the cache the chart is drawn from', () => {
  it('takes the new numbers', async () => {
    const pkg = await load()
    expect(writeChartCache(pkg, PART, { series: 0, values: [1, 2, 3, 4] })).toBe(true)

    expect(valuesOf(pkg)[0]).toEqual([1, 2, 3, 4])
  })

  it('leaves the other series alone', async () => {
    const pkg = await load()
    const before = valuesOf(pkg)[1]
    writeChartCache(pkg, PART, { series: 0, values: [1, 2, 3, 4] })

    expect(valuesOf(pkg)[1]).toEqual(before)
  })

  it('survives a save and a reopen', async () => {
    const pkg = await load()
    writeChartCache(pkg, PART, { series: 0, values: [1, 2, 3, 4] })

    expect(valuesOf(await readPptxPackage(await saveDeck(pkg)))[0]).toEqual([1, 2, 3, 4])
  })

  it('changes only the points it was given a number for', async () => {
    // Four points and two numbers is not a chart with two bars; it is a chart
    // with two bars changed.
    const pkg = await load()
    writeChartCache(pkg, PART, { series: 0, values: [1, 2] })

    expect(valuesOf(pkg)[0]).toEqual([1, 2, 9.8, 18.1])
  })

  it('says nothing changed when the numbers are the ones already there', async () => {
    const pkg = await load()
    expect(writeChartCache(pkg, PART, { series: 0, values: [10.5, 14.2, 9.8, 18.1] })).toBe(false)
  })

  it('says no to a series that is not there', async () => {
    const pkg = await load()
    expect(writeChartCache(pkg, PART, { series: 9, values: [1] })).toBe(false)
  })
})

describe('the workbook Edit Data opens', () => {
  it('gets the same numbers as the cache', async () => {
    const pkg = await load()
    const patched = await patchedWorkbook(pkg, PART, { series: 0, values: [1, 2, 3, 4] })
    if (patched === null) throw new Error('nothing was patched')

    pkg.parts.set(patched.path, { path: patched.path, bytes: patched.bytes, date: new Date() })

    // PowerPoint rebuilds the cache from here the moment anybody opens the
    // data, so a chart edited only in its cache loses the edit.
    const sheet = await sheetOf(pkg)
    expect(sheet).toContain('<c r="B2" s="1" t="n"><v>1</v></c>')
    expect(sheet).toContain('<v>4</v>')
  })

  it('leaves the cells of the other series where they were', async () => {
    const pkg = await load()
    const patched = await patchedWorkbook(pkg, PART, { series: 0, values: [1, 2, 3, 4] })
    if (patched === null) throw new Error('nothing was patched')

    pkg.parts.set(patched.path, { path: patched.path, bytes: patched.bytes, date: new Date() })
    expect(await sheetOf(pkg)).toContain('<v>7.1</v>')
  })

  it('answers nothing for a chart with no workbook behind it', async () => {
    const pkg = await load()
    pkg.parts.delete('ppt/embeddings/Microsoft_Excel_Sheet1.xlsx')

    // The cache is still worth writing, so this is not an error.
    expect(await patchedWorkbook(pkg, PART, { series: 0, values: [1] })).toBeNull()
  })
})

describe('the names along the bottom', () => {
  const namesOf = (pkg: OoxmlPackage) => {
    const chart = readChart(getPartText(pkg, PART) ?? '')
    return chart?.categories ?? []
  }

  it('takes a new name into the cache', async () => {
    const pkg = await load()
    expect(writeChartCategories(pkg, PART, { categories: ['Jan', 'Feb', 'Mar', 'Apr'] })).toBe(true)

    expect(namesOf(pkg)).toEqual(['Jan', 'Feb', 'Mar', 'Apr'])
  })

  it('changes every series, which all carry the same list', async () => {
    // A chart where two series disagreed about what Q2 is called is one
    // PowerPoint redraws from whichever it read last.
    const pkg = await load()
    writeChartCategories(pkg, PART, { categories: ['Jan', 'Feb', 'Mar', 'Apr'] })

    expect(getPartText(pkg, PART)?.match(/<c:v>Q2<\/c:v>/gu)).toBeNull()
    expect(getPartText(pkg, PART)?.match(/<c:v>Feb<\/c:v>/gu)).toHaveLength(2)
  })

  it('survives a save and a reopen', async () => {
    const pkg = await load()
    writeChartCategories(pkg, PART, { categories: ['Jan', 'Feb', 'Mar', 'Apr'] })

    expect(namesOf(await readPptxPackage(await saveDeck(pkg)))[0]).toBe('Jan')
  })

  it('changes only the ones it was given a name for', async () => {
    const pkg = await load()
    writeChartCategories(pkg, PART, { categories: ['Jan'] })

    expect(namesOf(pkg)).toEqual(['Jan', 'Q2', 'Q3', 'Q4'])
  })

  it('reaches the workbook too, as words rather than a number', async () => {
    const pkg = await load()
    const patched = await patchedWorkbook(pkg, PART, { categories: ['Jan', 'Feb', 'Mar', 'Apr'] })
    if (patched === null) throw new Error('nothing was patched')

    pkg.parts.set(patched.path, { path: patched.path, bytes: patched.bytes, date: new Date() })

    // An inline string, because the other way is an index into the workbook's
    // shared table and adding to that means keeping its counts right.
    const sheet = await sheetOf(pkg)
    expect(sheet).toContain('t="inlineStr"')
    expect(sheet).toContain('<t>Jan</t>')
  })

  it('says nothing changed when the names are the ones already there', async () => {
    const pkg = await load()
    expect(writeChartCategories(pkg, PART, { categories: ['Q1', 'Q2', 'Q3', 'Q4'] })).toBe(false)
  })
})
