import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { allSeries, chartKind, readChart } from './chart'
import type { Chart } from './chart'

const DECK = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic/charts.pptx')

/** The chart the part holds, with the check the types cannot make. */
const given = (chart: Chart | null): Chart => {
  if (chart === null) throw new Error('the part holds no chart')
  return chart
}

const kindOf = (chart: Chart | null) => chartKind(given(chart))

async function chartPart(name: string): Promise<string> {
  const zip = await JSZip.loadAsync(await readFile(DECK))
  const part = zip.file(`ppt/charts/${name}`)
  if (part === null) throw new Error(`${name} is not in the fixture`)
  return part.async('string')
}

describe('reading a chart from the deck', () => {
  it('reads a clustered column chart with both its series', async () => {
    const chart = readChart(await chartPart('chart1.xml'))

    expect(chart?.plots[0]).toMatchObject({
      kind: 'bar',
      direction: 'col',
      grouping: 'clustered',
    })
    expect(allSeries(given(chart)).map((series) => series.name)).toEqual(['Revenue', 'Costs'])
  })

  it('takes the values from the cache rather than the workbook', async () => {
    // The formula points into an embedded spreadsheet we never open; the cache
    // beside it is what PowerPoint draws from too.
    const chart = readChart(await chartPart('chart1.xml'))

    expect(allSeries(given(chart))[0]?.values).toEqual([10.5, 14.2, 9.8, 18.1])
    expect(allSeries(given(chart))[1]?.values).toEqual([7.1, 8.4, 8.9, 10])
  })

  it('reads the categories once, though every series repeats them', async () => {
    const chart = readChart(await chartPart('chart1.xml'))
    expect(chart?.categories).toEqual(['Q1', 'Q2', 'Q3', 'Q4'])
  })

  it('reads where the legend goes', async () => {
    expect(readChart(await chartPart('chart1.xml'))?.legend).toBe('b')
  })

  it('reads a line chart', async () => {
    const chart = readChart(await chartPart('chart2.xml'))
    expect(kindOf(chart)).toBe('line')
    expect(allSeries(given(chart))).toHaveLength(2)
  })

  it('reads a pie chart, which has one series', async () => {
    const chart = readChart(await chartPart('chart3.xml'))

    expect(kindOf(chart)).toBe('pie')
    expect(allSeries(given(chart))[0]?.values).toEqual([45, 30, 25])
    expect(chart?.categories).toEqual(['Alpha', 'Beta', 'Gamma'])
  })

  it('defaults a legend with no stated position to the right', async () => {
    expect(readChart(await chartPart('chart2.xml'))?.legend).toBe('r')
  })

  it('shows no legend where the chart has no legend element', async () => {
    expect(readChart(await chartPart('chart3.xml'))?.legend).toBeNull()
  })
})

describe('sparse points', () => {
  const sparse = (points: string) =>
    readChart(
      '<c:chartSpace xmlns:c="x"><c:chart><c:plotArea><c:lineChart>' +
        '<c:ser><c:val><c:numRef><c:numCache><c:ptCount val="4"/>' +
        points +
        '</c:numCache></c:numRef></c:val></c:ser>' +
        '</c:lineChart></c:plotArea></c:chart></c:chartSpace>',
    )

  it('puts each point at the index it states, leaving gaps null', () => {
    // A chart with a blank cell is ordinary. Reading points in document order
    // shifts everything after the gap one place left.
    const chart = sparse('<c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="3"><c:v>4</c:v></c:pt>')

    expect(allSeries(given(chart))[0]?.values).toEqual([1, null, null, 4])
  })

  it('trusts ptCount for the length, not how many points were written', () => {
    expect(allSeries(given(sparse('<c:pt idx="1"><c:v>2</c:v></c:pt>')))[0]?.values).toHaveLength(4)
  })

  it('reads a non-numeric point as a gap rather than NaN', () => {
    expect(
      allSeries(given(sparse('<c:pt idx="0"><c:v>#N/A</c:v></c:pt>')))[0]?.values[0],
    ).toBeNull()
  })
})

describe('a chart we do not draw', () => {
  it('is reported as unknown rather than as nothing', () => {
    // So the frame can be labelled instead of left blank.
    const chart = readChart(
      '<c:chartSpace xmlns:c="x"><c:chart><c:plotArea><c:radarChart/></c:plotArea></c:chart></c:chartSpace>',
    )

    expect(kindOf(chart)).toBe('unknown')
  })

  it('is null only when there is no plot area at all', () => {
    expect(readChart('<c:chartSpace xmlns:c="x"/>')).toBeNull()
    expect(readChart('<nonsense/>')).toBeNull()
  })
})

/** A chart part built by hand, for the shapes no fixture has. */
const chartOf = (plotArea: string) =>
  given(
    readChart(
      `<c:chartSpace xmlns:c="x"><c:chart><c:plotArea>${plotArea}</c:plotArea></c:chart></c:chartSpace>`,
    ),
  )

const cache = (tag: string, values: readonly (string | number)[]) =>
  `<c:${tag}><c:numRef><c:numCache><c:ptCount val="${String(values.length)}"/>` +
  values
    .map((value, index) => `<c:pt idx="${String(index)}"><c:v>${String(value)}</c:v></c:pt>`)
    .join('') +
  `</c:numCache></c:numRef></c:${tag}>`

describe('a scatter', () => {
  const scatter = (style = 'lineMarker') =>
    chartOf(
      `<c:scatterChart><c:scatterStyle val="${style}"/>` +
        `<c:ser>${cache('xVal', [1, 4, 9])}${cache('yVal', [10, 20, 30])}</c:ser>` +
        `<c:ser>${cache('xVal', [2, 3])}${cache('yVal', [5, 6])}</c:ser>` +
        '</c:scatterChart>',
    )

  it('reads an x for every point, not one list for the chart', () => {
    // Two series measured at different places is most of what a scatter is for.
    const series = allSeries(scatter())
    expect(series[0]?.xValues).toEqual([1, 4, 9])
    expect(series[1]?.xValues).toEqual([2, 3])
  })

  it('keeps the y values as the values', () => {
    expect(allSeries(scatter())[0]?.values).toEqual([10, 20, 30])
  })

  it('has no categories, because its bottom is a number line', () => {
    expect(scatter().categories).toEqual([])
  })

  it('says whether the points are joined', () => {
    expect(scatter('marker').plots[0]?.scatterStyle).toBe('marker')
    expect(scatter().plots[0]?.scatterStyle).toBe('lineMarker')
  })

  it('leaves every other kind without x values at all', () => {
    const bars = chartOf(`<c:barChart><c:ser>${cache('val', [1, 2])}</c:ser></c:barChart>`)
    expect(allSeries(bars)[0]?.xValues).toBeNull()
  })
})

describe('data labels', () => {
  const labelled = (flags: string) =>
    chartOf(
      `<c:barChart><c:dLbls>${flags}</c:dLbls><c:ser>${cache('val', [1])}</c:ser></c:barChart>`,
    )

  it('reads which of them a group asks for', () => {
    const labels = labelled('<c:showVal val="1"/><c:showCatName val="0"/>').plots[0]?.labels
    expect(labels).toEqual({ values: true, categories: false, percentages: false })
  })

  it('reads a pie asking for shares rather than numbers', () => {
    expect(labelled('<c:showPercent val="1"/>').plots[0]?.labels.percentages).toBe(true)
  })

  it('asks for none where the group says nothing', () => {
    const bare = chartOf(`<c:barChart><c:ser>${cache('val', [1])}</c:ser></c:barChart>`)
    expect(bare.plots[0]?.labels).toEqual({
      values: false,
      categories: false,
      percentages: false,
    })
  })
})

describe('a chart with two groups', () => {
  const combination = chartOf(
    `<c:barChart><c:axId val="1"/><c:axId val="2"/><c:ser>${cache('val', [10, 20])}</c:ser></c:barChart>` +
      `<c:lineChart><c:axId val="3"/><c:axId val="4"/><c:ser>${cache('val', [0.1, 0.2])}</c:ser></c:lineChart>`,
  )

  it('reads both, rather than the first and nothing else', () => {
    expect(combination.plots.map((plot) => plot.kind)).toEqual(['bar', 'line'])
  })

  it('says which one is measured against the other axis', () => {
    // A revenue in millions beside a margin in percent: one scale for both
    // would draw the margin as a flat line along the bottom.
    expect(combination.plots[0]?.secondary).toBe(false)
    expect(combination.plots[1]?.secondary).toBe(true)
  })

  it('calls neither secondary when they share their axes', () => {
    const together = chartOf(
      `<c:barChart><c:axId val="1"/><c:axId val="2"/><c:ser>${cache('val', [1])}</c:ser></c:barChart>` +
        `<c:lineChart><c:axId val="1"/><c:axId val="2"/><c:ser>${cache('val', [2])}</c:ser></c:lineChart>`,
    )

    expect(together.plots.every((plot) => !plot.secondary)).toBe(true)
  })

  it('gives every series of both, in the order the groups list them', () => {
    expect(allSeries(combination)).toHaveLength(2)
  })
})
