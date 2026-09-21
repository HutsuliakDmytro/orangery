import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import { allSeries, axesOfPlot, chartKind, readChart } from './chart'
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

describe('a chart we do not model', () => {
  it('is named rather than reported as nothing', () => {
    // So the frame can say what is missing instead of standing there blank.
    const chart = readChart(
      '<c:chartSpace xmlns:c="x"><c:chart><c:plotArea><c:stockChart/></c:plotArea></c:chart></c:chartSpace>',
    )

    expect(kindOf(chart)).toBe('unsupported')
    expect(chart?.unsupported).toEqual({ label: 'Stock chart' })
  })

  it('names a kind nobody has written down here from its own tag', () => {
    const chart = readChart(
      '<c:chartSpace xmlns:c="x"><c:chart><c:plotArea><c:pyramidChart/></c:plotArea></c:chart></c:chartSpace>',
    )

    expect(chart?.unsupported).toEqual({ label: 'Pyramid chart' })
  })

  it('says nothing is missing when one group of two can be drawn', () => {
    // Half a combination chart is still worth drawing.
    const chart = chartOf(
      `<c:barChart><c:ser>${cache('val', [1])}</c:ser></c:barChart><c:stockChart/>`,
    )

    expect(chart.unsupported).toBeNull()
    expect(chart.plots.map((plot) => plot.kind)).toEqual(['bar', 'unsupported'])
  })

  it('reads a cx: chart far enough to name it', () => {
    // A different namespace with a different schema. Nothing of it is
    // modelled, and a waterfall drawn as bars would put wrong numbers on the
    // slide.
    const chart = readChart(
      '<cx:chartSpace xmlns:cx="x"><cx:chart><cx:plotArea><cx:plotAreaRegion>' +
        '<cx:series layoutId="waterfall"/></cx:plotAreaRegion></cx:plotArea></cx:chart></cx:chartSpace>',
    )

    expect(chart?.unsupported).toEqual({ label: 'Waterfall chart' })
    expect(chart?.plots).toEqual([])
  })

  it('keeps the part it was read from, so saving can patch it', () => {
    const chart = chartOf(`<c:barChart><c:ser>${cache('val', [1])}</c:ser></c:barChart>`)
    expect(chart.source.space).toBeDefined()
    expect(chart.source.roots.length).toBeGreaterThan(0)
  })

  it('is null only when there is no chart in the part at all', () => {
    expect(readChart('<c:chartSpace xmlns:c="x"/>')).toBeNull()
    expect(readChart('<nonsense/>')).toBeNull()
  })
})

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
    expect(labels).toEqual({
      values: true,
      categories: false,
      percentages: false,
      seriesName: false,
    })
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
      seriesName: false,
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

describe('the cells behind a chart', () => {
  const referenced = chartOf(
    '<c:barChart><c:ser>' +
      '<c:tx><c:strRef><c:f>Sheet1!$B$1</c:f><c:strCache><c:ptCount val="1"/>' +
      '<c:pt idx="0"><c:v>Revenue</c:v></c:pt></c:strCache></c:strRef></c:tx>' +
      '<c:cat><c:strRef><c:f>Sheet1!$A$2:$A$3</c:f><c:strCache><c:ptCount val="2"/>' +
      '<c:pt idx="0"><c:v>Q1</c:v></c:pt><c:pt idx="1"><c:v>Q2</c:v></c:pt>' +
      '</c:strCache></c:strRef></c:cat>' +
      '<c:val><c:numRef><c:f>Sheet1!$B$2:$B$3</c:f><c:numCache><c:ptCount val="2"/>' +
      '<c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt>' +
      '</c:numCache></c:numRef></c:val>' +
      '</c:ser></c:barChart>',
  )

  it('reads the range each part of a series points at', () => {
    // An app that owns those cells has to know which ones they are: it is the
    // whole difference between a chart in a deck and a chart in a sheet.
    const series = allSeries(referenced)[0]

    expect(series?.nameRef).toBe('Sheet1!$B$1')
    expect(series?.categoriesRef).toBe('Sheet1!$A$2:$A$3')
    expect(series?.valuesRef).toBe('Sheet1!$B$2:$B$3')
  })

  it('still draws from the cache rather than from the range', () => {
    expect(allSeries(referenced)[0]?.values).toEqual([1, 2])
    expect(referenced.categories).toEqual(['Q1', 'Q2'])
  })

  it('leaves the range null where the chart names none', () => {
    const inline = chartOf(`<c:barChart><c:ser>${cache('val', [1])}</c:ser></c:barChart>`)
    expect(allSeries(inline)[0]?.valuesRef).toBeNull()
  })

  it('reads categories written in tiers from the tier that names the points', () => {
    // Months under quarters: reading past the first level would put a
    // quarter's name on a month.
    const tiered = chartOf(
      '<c:barChart><c:ser><c:cat><c:multiLvlStrRef><c:f>Sheet1!$A$2:$B$3</c:f>' +
        '<c:multiLvlStrCache><c:ptCount val="2"/>' +
        '<c:lvl><c:pt idx="0"><c:v>Jan</c:v></c:pt><c:pt idx="1"><c:v>Feb</c:v></c:pt></c:lvl>' +
        '<c:lvl><c:pt idx="0"><c:v>Q1</c:v></c:pt></c:lvl>' +
        '</c:multiLvlStrCache></c:multiLvlStrRef></c:cat></c:ser></c:barChart>',
    )

    expect(tiered.categories).toEqual(['Jan', 'Feb'])
  })
})

describe('axes', () => {
  const axes = chartOf(
    `<c:barChart><c:axId val="1"/><c:axId val="2"/><c:ser>${cache('val', [1])}</c:ser></c:barChart>` +
      '<c:catAx><c:axId val="1"/><c:axPos val="b"/><c:delete val="0"/></c:catAx>' +
      '<c:valAx><c:axId val="2"/><c:axPos val="l"/><c:majorGridlines/>' +
      '<c:numFmt formatCode="#,##0.0" sourceLinked="0"/>' +
      '<c:scaling><c:orientation val="maxMin"/><c:min val="40"/><c:max val="100"/></c:scaling>' +
      '<c:majorUnit val="10"/><c:crossesAt val="40"/></c:valAx>',
  )

  it('reads both, with the kind each one is', () => {
    expect(axes.axes.map((axis) => axis.kind)).toEqual(['category', 'value'])
  })

  it('reads the scale, which decides how the chart is drawn', () => {
    const value = axes.axes[1]

    expect(value?.min).toBe(40)
    expect(value?.max).toBe(100)
    expect(value?.majorUnit).toBe(10)
    expect(value?.reversed).toBe(true)
    expect(value?.crossesAt).toBe(40)
  })

  it('reads the number format, which the tick labels and data labels both use', () => {
    expect(axes.axes[1]?.numberFormat).toBe('#,##0.0')
    expect(axes.axes[0]?.numberFormat).toBeNull()
  })

  it('reads a hidden axis rather than dropping it', () => {
    // `c:delete` hides the axis; the scale it states still applies.
    const hidden = chartOf(
      '<c:barChart><c:axId val="1"/></c:barChart>' +
        '<c:valAx><c:axId val="1"/><c:delete val="1"/><c:scaling><c:max val="5"/></c:scaling></c:valAx>',
    )

    expect(hidden.axes[0]?.hidden).toBe(true)
    expect(hidden.axes[0]?.max).toBe(5)
  })

  it('says which axes belong to the second pair', () => {
    const combination = chartOf(
      `<c:barChart><c:axId val="1"/><c:axId val="2"/><c:ser>${cache('val', [1])}</c:ser></c:barChart>` +
        `<c:lineChart><c:axId val="3"/><c:axId val="4"/><c:ser>${cache('val', [2])}</c:ser></c:lineChart>` +
        '<c:catAx><c:axId val="1"/></c:catAx><c:valAx><c:axId val="2"/></c:valAx>' +
        '<c:catAx><c:axId val="3"/></c:catAx><c:valAx><c:axId val="4"/></c:valAx>',
    )

    expect(combination.axes.map((axis) => axis.secondary)).toEqual([false, false, true, true])
  })

  it('hands a group the axes it names', () => {
    const plot = axes.plots[0]
    expect(plot === undefined ? [] : axesOfPlot(axes, plot).map((axis) => axis.id)).toEqual([
      '1',
      '2',
    ])
  })

  it('reads a date axis as its own kind, not as categories', () => {
    // The gaps between dates are real distances; drawn as categories, a
    // month with no reading takes the same width as one with four.
    const dated = chartOf(
      '<c:lineChart><c:axId val="1"/></c:lineChart><c:dateAx><c:axId val="1"/></c:dateAx>',
    )

    expect(dated.axes[0]?.kind).toBe('date')
  })
})

describe('a radar', () => {
  const radar = chartOf(
    `<c:radarChart><c:radarStyle val="filled"/><c:ser>${cache('val', [1, 2, 3])}</c:ser></c:radarChart>`,
  )

  it('is read as itself now that it is modelled', () => {
    expect(chartKind(radar)).toBe('radar')
    expect(radar.unsupported).toBeNull()
  })

  it('says whether it is an outline or an area', () => {
    expect(radar.plots[0]?.radarStyle).toBe('filled')
  })
})

describe('how a group is drawn', () => {
  it('reads the numbers Office writes for spacing', () => {
    const bars = chartOf(
      `<c:barChart><c:gapWidth val="150"/><c:overlap val="-27"/><c:ser>${cache('val', [1])}</c:ser></c:barChart>`,
    )

    expect(bars.plots[0]).toMatchObject({ gapWidth: 150, overlap: -27 })
  })

  it('reads the hole of a doughnut and where a pie starts', () => {
    const round = chartOf(
      `<c:doughnutChart><c:varyColors val="1"/><c:holeSize val="75"/><c:firstSliceAng val="90"/>` +
        `<c:ser>${cache('val', [1])}</c:ser></c:doughnutChart>`,
    )

    expect(round.plots[0]).toMatchObject({ holeSize: 75, firstSliceAngle: 90, varyColors: true })
  })

  it('leaves what the chart does not say null, rather than guessing a default', () => {
    // The defaults belong to the renderer, which knows what it is drawing; a
    // model that invented 150 here could not tell a stated 150 from a silence.
    const bare = chartOf(`<c:barChart><c:ser>${cache('val', [1])}</c:ser></c:barChart>`)
    expect(bare.plots[0]).toMatchObject({ gapWidth: null, overlap: null, holeSize: null })
  })
})

describe('a series that formats itself', () => {
  const pie = chartOf(
    '<c:pieChart><c:ser><c:idx val="0"/><c:order val="0"/>' +
      '<c:dPt><c:idx val="1"/><c:spPr><a:solidFill xmlns:a="a"><a:srgbClr val="FF0000"/></a:solidFill></c:spPr></c:dPt>' +
      '<c:dLbls><c:showPercent val="1"/></c:dLbls>' +
      `${cache('val', [1, 2, 3])}</c:ser></c:pieChart>`,
  )

  it('reads a point coloured apart from its series', () => {
    // One series, every slice its own colour: a reader that ignored these
    // would draw a pie in one colour.
    expect(allSeries(pie)[0]?.points).toMatchObject([
      { index: 1, color: { source: { kind: 'srgb', hex: '#FF0000' } } },
    ])
  })

  it('reads the labels a series asks for over its group', () => {
    expect(allSeries(pie)[0]?.labels?.percentages).toBe(true)
  })

  it('leaves the override null where the series says nothing', () => {
    const plain = chartOf(`<c:barChart><c:ser>${cache('val', [1])}</c:ser></c:barChart>`)
    expect(allSeries(plain)[0]?.labels).toBeNull()
  })

  it('reads where the series sits and which colour it takes', () => {
    const series = allSeries(pie)[0]
    expect(series?.index).toBe(0)
    expect(series?.order).toBe(0)
  })

  it('reads a marker, and a line that says it has none', () => {
    const line = chartOf(
      '<c:lineChart>' +
        `<c:ser><c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker><c:smooth val="1"/>${cache('val', [1])}</c:ser>` +
        `<c:ser><c:marker><c:symbol val="none"/></c:marker>${cache('val', [2])}</c:ser>` +
        '</c:lineChart>',
    )

    expect(allSeries(line)[0]?.marker).toEqual({ symbol: 'circle', size: 5 })
    expect(allSeries(line)[0]?.smooth).toBe(true)
    expect(allSeries(line)[1]?.marker).toEqual({ symbol: 'none', size: null })
  })
})

describe('a title', () => {
  it('reads one written out in the chart, across however many runs', () => {
    const titled = readChart(
      '<c:chartSpace xmlns:c="x"><c:chart><c:title><c:tx><c:rich><a:p xmlns:a="a">' +
        '<a:r><a:t>Quarterly </a:t></a:r><a:r><a:t>revenue</a:t></a:r>' +
        '</a:p></c:rich></c:tx></c:title><c:plotArea><c:barChart/></c:plotArea></c:chart></c:chartSpace>',
    )

    expect(titled?.title).toBe('Quarterly revenue')
  })

  it('reads one that reads itself from a cell', () => {
    // A title bound to a heading keeps its words in the cache beside the
    // reference, not in the chart.
    const titled = readChart(
      '<c:chartSpace xmlns:c="x"><c:chart><c:title><c:tx><c:strRef><c:f>Sheet1!$A$1</c:f>' +
        '<c:strCache><c:ptCount val="1"/><c:pt idx="0"><c:v>Quarterly revenue</c:v></c:pt>' +
        '</c:strCache></c:strRef></c:tx></c:title><c:plotArea><c:barChart/></c:plotArea>' +
        '</c:chart></c:chartSpace>',
    )

    expect(titled?.title).toBe('Quarterly revenue')
  })

  it('reads the title of an axis, which is the same element', () => {
    const axis = chartOf(
      '<c:barChart><c:axId val="1"/></c:barChart>' +
        '<c:valAx><c:axId val="1"/><c:title><c:tx><c:rich><a:p xmlns:a="a"><a:r><a:t>Millions</a:t></a:r></a:p></c:rich></c:tx></c:title></c:valAx>',
    )

    expect(axis.axes[0]?.title).toBe('Millions')
  })
})

describe('what a series says beyond its numbers', () => {
  const fitted = chartOf(
    '<c:lineChart><c:ser>' +
      '<c:trendline><c:name>Fit</c:name><c:trendlineType val="poly"/><c:order val="2"/>' +
      '<c:forward val="2"/><c:dispEq val="1"/><c:dispRSqr val="1"/></c:trendline>' +
      '<c:errBars><c:errDir val="y"/><c:errBarType val="both"/>' +
      '<c:errValType val="percentage"/><c:val val="5"/></c:errBars>' +
      `${cache('val', [1, 2])}</c:ser></c:lineChart>`,
  )

  it('reads the fit a chart asks for rather than computing one of its own', () => {
    expect(allSeries(fitted)[0]?.trendlines).toEqual([
      {
        kind: 'poly',
        order: 2,
        period: null,
        forward: 2,
        backward: null,
        showEquation: true,
        showR2: true,
        name: 'Fit',
      },
    ])
  })

  it('reads the whiskers, with the amount and what the amount means', () => {
    expect(allSeries(fitted)[0]?.errorBars).toEqual([
      { direction: 'y', kind: 'both', valueType: 'percentage', value: 5 },
    ])
  })

  it('reads the whole of c:spPr, not only the colour the renderer wants', () => {
    const styled = chartOf(
      '<c:barChart><c:ser><c:spPr xmlns:a="a">' +
        '<a:solidFill><a:schemeClr val="accent2"/></a:solidFill>' +
        '<a:ln w="19050"><a:solidFill><a:srgbClr val="000000"/></a:solidFill></a:ln>' +
        `</c:spPr>${cache('val', [1])}</c:ser></c:barChart>`,
    )
    const series = allSeries(styled)[0]

    // The theme colour stays symbolic: resolved when drawing, never when saving.
    expect(series?.color).toEqual({ source: { kind: 'scheme', name: 'accent2' }, transforms: [] })
    expect(series?.properties?.line?.width).toBe(19050)
  })

  it('leaves the colour null where the fill is not a solid one', () => {
    const gradient = chartOf(
      '<c:barChart><c:ser><c:spPr xmlns:a="a"><a:gradFill><a:gsLst>' +
        '<a:gs pos="0"><a:srgbClr val="FF0000"/></a:gs>' +
        '<a:gs pos="100000"><a:srgbClr val="0000FF"/></a:gs>' +
        `</a:gsLst></a:gradFill></c:spPr>${cache('val', [1])}</c:ser></c:barChart>`,
    )

    expect(allSeries(gradient)[0]?.color).toBeNull()
    expect(allSeries(gradient)[0]?.properties?.fill?.kind).toBe('gradient')
  })
})

describe('what the chart says about itself', () => {
  it('reads the grid of numbers some charts print under the plot', () => {
    const tabled = chartOf(
      `<c:barChart><c:ser>${cache('val', [1])}</c:ser></c:barChart>` +
        '<c:dTable><c:showLegendKey val="1"/></c:dTable>',
    )

    expect(tabled.dataTable).toEqual({ legendKeys: true })
  })

  it('reads the built-in style id, which is what an uncoloured chart is coloured by', () => {
    const styled = readChart(
      '<c:chartSpace xmlns:c="x"><c:style val="34"/><c:chart><c:plotArea>' +
        '<c:barChart/></c:plotArea></c:chart></c:chartSpace>',
    )

    expect(styled?.styleId).toBe(34)
  })

  it('reads how a line is meant to cross a blank', () => {
    // Drawn as a gap, as zero, or bridged: three different pictures of the
    // same numbers, and the file is the one that decides.
    const spanning = readChart(
      '<c:chartSpace xmlns:c="x"><c:chart><c:plotArea><c:lineChart/></c:plotArea>' +
        '<c:dispBlanksAs val="span"/></c:chart></c:chartSpace>',
    )

    expect(spanning?.blanks).toBe('span')
  })
})

describe('where the plot area was put', () => {
  const laid = (layout: string) =>
    chartOf(
      `<c:layout>${layout}</c:layout>` +
        `<c:barChart><c:ser>${cache('val', [1])}</c:ser></c:barChart>`,
    )

  it('reads a stated position as a fraction of the chart', () => {
    const chart = laid(
      '<c:manualLayout><c:layoutTarget val="inner"/>' +
        '<c:xMode val="edge"/><c:yMode val="edge"/><c:wMode val="edge"/><c:hMode val="edge"/>' +
        '<c:x val="0.2"/><c:y val="0.1"/><c:w val="0.7"/><c:h val="0.8"/></c:manualLayout>',
    )

    expect(chart.plotLayout).toEqual({
      target: 'inner',
      x: 0.2,
      y: 0.1,
      width: 0.7,
      height: 0.8,
    })
  })

  it('reads an offset as nothing, because it is an offset from Office’s own layout', () => {
    // A chart drawn automatically is drawn nearly right; one nudged by a
    // misunderstood offset is drawn wrong on purpose.
    const chart = laid('<c:manualLayout><c:x val="0.05"/><c:y val="-0.02"/></c:manualLayout>')

    expect(chart.plotLayout).toEqual({
      target: 'outer',
      x: null,
      y: null,
      width: null,
      height: null,
    })
  })

  it('reads a position without a size, which is a plot area dragged but not resized', () => {
    const chart = laid('<c:manualLayout><c:xMode val="edge"/><c:x val="0.3"/></c:manualLayout>')

    expect(chart.plotLayout).toMatchObject({ x: 0.3, width: null })
  })

  it('is null for the automatic layout, which is what most charts have', () => {
    expect(laid('').plotLayout).toBeNull()
    expect(
      chartOf(`<c:barChart><c:ser>${cache('val', [1])}</c:ser></c:barChart>`).plotLayout,
    ).toBeNull()
  })
})
