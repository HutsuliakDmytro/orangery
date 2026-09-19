import { describe, expect, it } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { openSheet, readCell } from '@orangery/ooxml-spreadsheet'
import { allSeries, readChart } from './chart'
import { applyChartEdits } from './chart-edit'
import { defaultChartData, newChartPart, newChartWorkbook } from './chart-template'
import type { NewChartKind } from './chart-template'

/**
 * A chart made from nothing.
 *
 * Read back through our own reader, which is the nearest thing to opening the
 * result in Office that a test can do: every element the reader finds is one
 * that was written where the schema says it goes.
 */

const KINDS: NewChartKind[] = ['bar', 'line', 'area', 'pie', 'scatter']

const chartOf = (kind: NewChartKind) => {
  const chart = readChart(newChartPart(kind))
  if (chart === null) throw new Error(`a new ${kind} chart is not readable`)
  return chart
}

describe('the five kinds a new chart can be', () => {
  it.each(KINDS)('reads back as the kind it was asked for: %s', (kind) => {
    expect(chartOf(kind).plots[0]?.kind).toBe(kind)
  })

  it.each(KINDS)('has numbers in it, not an empty frame: %s', (kind) => {
    const series = allSeries(chartOf(kind))

    expect(series.length).toBeGreaterThan(0)
    expect(series[0]?.values.every((value) => value !== null)).toBe(true)
  })

  it.each(KINDS)('points every series at the cells it came from: %s', (kind) => {
    const series = allSeries(chartOf(kind))[0]
    // One row per category, under the header — a scatter's default table is
    // three rows long and everything else's is four.
    const last = defaultChartData(kind).categories.length + 1

    expect(series?.nameRef).toBe('Sheet1!$B$1')
    expect(series?.valuesRef).toBe(`Sheet1!$B$2:$B$${String(last)}`)
  })

  it('names its categories, except a scatter, which measures them', () => {
    expect(chartOf('bar').categories).toEqual([
      'Category 1',
      'Category 2',
      'Category 3',
      'Category 4',
    ])
    expect(chartOf('scatter').categories).toEqual([])
    expect(allSeries(chartOf('scatter'))[0]?.xValues).toEqual([0.7, 1.8, 2.6])
  })

  it('gives a pie one series, because a second would be a ring it cannot draw', () => {
    expect(allSeries(chartOf('pie'))).toHaveLength(1)
    expect(chartOf('pie').plots[0]?.varyColors).toBe(true)
  })

  it('gives the kinds that need axes a pair, and the pie none', () => {
    expect(chartOf('bar').axes.map((axis) => axis.kind)).toEqual(['category', 'value'])
    // Both of a scatter's axes measure.
    expect(chartOf('scatter').axes.map((axis) => axis.kind)).toEqual(['value', 'value'])
    expect(chartOf('pie').axes).toEqual([])
  })

  it('states the spacing Office states, rather than leaving it to a reader', () => {
    expect(chartOf('bar').plots[0]).toMatchObject({ gapWidth: 150, overlap: -27 })
  })

  it('shows a legend and says what to do with a blank', () => {
    expect(chartOf('line').legend).toBe('b')
    expect(chartOf('line').blanks).toBe('gap')
  })

  it('points at the workbook Edit Data opens', () => {
    // Without it the chart draws from its cache and offers no way back to the
    // numbers.
    expect(newChartPart('bar')).toContain('<c:externalData r:id="rId1">')
  })
})

describe('the workbook beside it', () => {
  const workbook = newChartWorkbook(defaultChartData('bar'))
  const sheet = openSheet(workbook, 'xl/worksheets/sheet1.xml')

  it('lays the table out the way the references expect', () => {
    if (sheet === null) throw new Error('the workbook has no sheet')

    expect(readCell(sheet, 'B1', [])).toBe('Series 1')
    expect(readCell(sheet, 'A2', [])).toBe('Category 1')
    expect(readCell(sheet, 'B2', [])).toBe(4.3)
    expect(readCell(sheet, 'D5', [])).toBe(5)
  })

  it('agrees with the cache the chart is drawn from', () => {
    // The two are one table described twice; a mismatch is a chart whose
    // editor shows the wrong cells.
    if (sheet === null) throw new Error('the workbook has no sheet')

    const cached = allSeries(chartOf('bar'))[0]?.values ?? []
    const cells = ['B2', 'B3', 'B4', 'B5'].map((reference) => readCell(sheet, reference, []))

    expect(cells).toEqual(cached)
  })

  it('is a package a reader can open', () => {
    expect(getPartText(workbook, 'xl/workbook.xml')).toContain('name="Sheet1"')
  })
})

describe('a new chart as something to edit', () => {
  it('takes an edit like any other chart', () => {
    // The point of writing it in schema order: the serialiser finds the same
    // elements in it that it finds in a chart made by Office.
    const written = applyChartEdits(newChartPart('bar'), [
      { kind: 'legend', position: 'r' },
      { kind: 'title', text: 'Revenue' },
      { kind: 'axis', id: '222222222', max: 10 },
    ])

    const chart = readChart(written ?? '')
    expect(chart?.legend).toBe('r')
    expect(chart?.title).toBe('Revenue')
    expect(chart?.axes.find((axis) => axis.kind === 'value')?.max).toBe(10)
  })

  it('can be turned into another kind straight away', () => {
    const written = applyChartEdits(newChartPart('bar'), [{ kind: 'plotType', plot: 0, to: 'pie' }])
    expect(readChart(written ?? '')?.plots[0]?.kind).toBe('pie')
  })
})
