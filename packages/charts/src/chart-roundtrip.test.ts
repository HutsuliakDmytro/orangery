import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import JSZip from 'jszip'
import {
  buildXml,
  compareXml,
  describeDifferences,
  parseXml,
  withDeclaration,
} from '@orangery/ooxml-core'
import { applyChartEdits } from './chart-edit'
import { writeChartCache, writeXValuesIn } from './chart-data'
import { allSeries, readChart } from './chart'

/**
 * What a save does to a chart nobody edited, and to one somebody did.
 *
 * The guarantee is the one the ADR states: a chart carries back every element
 * we do not model. These tests are how that is checked — not by reading the
 * model back, which would only prove the model is self-consistent, but by
 * diffing the part against the part the file had.
 */

const DECK = join(process.cwd(), '../../apps/slides/tests/fixtures/pptx/synthetic/charts.pptx')

const PARTS = ['chart1.xml', 'chart2.xml', 'chart3.xml']

async function chartPart(name: string): Promise<string> {
  const zip = await JSZip.loadAsync(await readFile(DECK))
  const part = zip.file(`ppt/charts/${name}`)
  if (part === null) throw new Error(`${name} is not in the fixture`)
  return part.async('string')
}

/** The differences between two versions of a part, as a reader would see them. */
const differences = (before: string, after: string) => compareXml(before, after)

describe('a chart nobody edited', () => {
  it.each(PARTS)('is not rewritten at all: %s', async (name) => {
    // Null rather than the same string: a caller that wrote unconditionally
    // would turn a chart nobody touched into a changed part.
    expect(applyChartEdits(await chartPart(name), [])).toBeNull()
  })

  it.each(PARTS)('survives being read and written unchanged: %s', async (name) => {
    // The path a chart takes when something else in it is edited. If the
    // writer lost anything, every edit would lose it too.
    const before = await chartPart(name)
    const after = withDeclaration(buildXml(parseXml(before)))

    expect(describeDifferences(differences(before, after))).toBe('no differences')
  })
})

describe('a chart with one thing changed', () => {
  it('differs in the legend and nowhere else', async () => {
    const before = await chartPart('chart1.xml')
    const after = applyChartEdits(before, [{ kind: 'legend', position: 't' }]) ?? ''

    const changed = differences(before, after)
    expect(changed).toHaveLength(1)
    expect(changed[0]?.path).toContain('c:legend')
  })

  it('differs in one series when one series is recoloured', async () => {
    const before = await chartPart('chart1.xml')
    const after =
      applyChartEdits(before, [
        {
          kind: 'seriesColor',
          series: 1,
          color: { source: { kind: 'srgb', hex: '#00FF00' }, transforms: [] },
        },
      ]) ?? ''

    const changed = differences(before, after)
    expect(changed.every((one) => one.path.includes('c:ser'))).toBe(true)
    // The first series is untouched, and so is everything around the groups.
    expect(readChart(after)?.plots[0]?.series[0]?.color).toEqual(
      readChart(before)?.plots[0]?.series[0]?.color,
    )
  })

  it('keeps the numbers when the kind changes', async () => {
    const before = await chartPart('chart1.xml')
    const after = applyChartEdits(before, [{ kind: 'plotType', plot: 0, to: 'line' }]) ?? ''

    const numbers = (xml: string) =>
      (readChart(xml)?.plots[0]?.series ?? []).map((series) => series.values)

    expect(numbers(after)).toEqual(numbers(before))
    // And the references, so "Edit Data" still opens the same cells.
    expect(after).toContain('Sheet1!$B$2')
  })
})

describe('a number changed in the cache', () => {
  it('moves one point and leaves the rest of the part alone', async () => {
    const before = await chartPart('chart1.xml')
    const pkg = { parts: new Map() }
    const { setPartText, getPartText } = await import('@orangery/ooxml-core')

    setPartText(pkg, 'ppt/charts/chart1.xml', before)
    expect(
      writeChartCache(pkg, 'ppt/charts/chart1.xml', { series: 0, values: [10.5, 99, 9.8, 18.1] }),
    ).toBe(true)

    const after = getPartText(pkg, 'ppt/charts/chart1.xml') ?? ''
    const changed = differences(before, after)

    // Exactly one point of one series: `c:numCache` is what a chart is drawn
    // from, and a diff wider than this would mean the writer rebuilt something.
    expect(changed).toHaveLength(1)
    expect(changed[0]?.path).toContain('c:numCache')
    expect(changed[0]?.message).toContain('99')
  })

  it('writes nothing when the numbers are the ones already there', async () => {
    const before = await chartPart('chart1.xml')
    const pkg = { parts: new Map() }
    const { setPartText } = await import('@orangery/ooxml-core')
    setPartText(pkg, 'ppt/charts/chart1.xml', before)

    expect(
      writeChartCache(pkg, 'ppt/charts/chart1.xml', { series: 0, values: [10.5, 14.2, 9.8, 18.1] }),
    ).toBe(false)
  })
})

describe('a point emptied rather than zeroed', () => {
  it('leaves no point in the cache, which is how a gap is written', async () => {
    const before = await chartPart('chart1.xml')
    const { getPartText, setPartText } = await import('@orangery/ooxml-core')
    const pkg = { parts: new Map() }
    setPartText(pkg, 'ppt/charts/chart1.xml', before)

    // A nought is a bar of no height; a gap is no bar at all, and the two are
    // different pictures of different data.
    expect(
      writeChartCache(pkg, 'ppt/charts/chart1.xml', {
        series: 0,
        values: [10.5, null, 9.8, 18.1],
      }),
    ).toBe(true)

    const after = getPartText(pkg, 'ppt/charts/chart1.xml') ?? ''
    const chart = readChart(after)

    expect(chart?.plots[0]?.series[0]?.values).toEqual([10.5, null, 9.8, 18.1])
    // The count still says four: the chart has four points, one of them blank.
    expect(after).toContain('<c:ptCount val="4"/>')
  })

  it('empties several at once without losing the ones between them', async () => {
    const before = await chartPart('chart1.xml')
    const { getPartText, setPartText } = await import('@orangery/ooxml-core')
    const pkg = { parts: new Map() }
    setPartText(pkg, 'ppt/charts/chart1.xml', before)

    writeChartCache(pkg, 'ppt/charts/chart1.xml', { series: 0, values: [null, 14.2, null, 18.1] })

    const chart = readChart(getPartText(pkg, 'ppt/charts/chart1.xml') ?? '')
    expect(chart?.plots[0]?.series[0]?.values).toEqual([null, 14.2, null, 18.1])
  })
})

describe('a scatter moved along the bottom', () => {
  const SCATTER =
    '<c:chartSpace xmlns:c="c"><c:chart><c:plotArea><c:scatterChart>' +
    '<c:ser><c:xVal><c:numRef><c:f>Sheet1!$A$2:$A$3</c:f><c:numCache><c:ptCount val="2"/>' +
    '<c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt>' +
    '</c:numCache></c:numRef></c:xVal>' +
    '<c:yVal><c:numRef><c:numCache><c:ptCount val="2"/>' +
    '<c:pt idx="0"><c:v>10</c:v></c:pt><c:pt idx="1"><c:v>20</c:v></c:pt>' +
    '</c:numCache></c:numRef></c:yVal></c:ser>' +
    '<c:ser><c:xVal><c:numRef><c:f>Sheet1!$A$2:$A$3</c:f><c:numCache><c:ptCount val="2"/>' +
    '<c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt>' +
    '</c:numCache></c:numRef></c:xVal>' +
    '<c:yVal><c:numRef><c:numCache><c:ptCount val="2"/>' +
    '<c:pt idx="0"><c:v>30</c:v></c:pt><c:pt idx="1"><c:v>40</c:v></c:pt>' +
    '</c:numCache></c:numRef></c:yVal></c:ser>' +
    '</c:scatterChart></c:plotArea></c:chart></c:chartSpace>'

  it('moves a point, leaving its height where it was', () => {
    const written = writeXValuesIn(SCATTER, { series: 0, xValues: [1, 9] }) ?? ''
    const series = allSeries(readChart(written) ?? ({ plots: [] } as never))

    expect(series[0]?.xValues).toEqual([1, 9])
    expect(series[0]?.values).toEqual([10, 20])
  })

  it('moves it for every series reading the same cells', () => {
    // Two series measured against one column have to agree about what it
    // says, or the chart draws the same range two different ways.
    const written = writeXValuesIn(SCATTER, { series: 0, xValues: [1, 9] }) ?? ''
    const series = allSeries(readChart(written) ?? ({ plots: [] } as never))

    expect(series[1]?.xValues).toEqual([1, 9])
  })

  it('leaves a series measured against its own cells alone', () => {
    const apart = SCATTER.replace(
      '<c:f>Sheet1!$A$2:$A$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:xVal><c:yVal><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>30</c:v>',
      '<c:f>Sheet1!$D$2:$D$3</c:f><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>1</c:v></c:pt><c:pt idx="1"><c:v>2</c:v></c:pt></c:numCache></c:numRef></c:xVal><c:yVal><c:numRef><c:numCache><c:ptCount val="2"/><c:pt idx="0"><c:v>30</c:v>',
    )

    const written = writeXValuesIn(apart, { series: 0, xValues: [1, 9] }) ?? ''
    const series = allSeries(readChart(written) ?? ({ plots: [] } as never))

    expect(series[0]?.xValues).toEqual([1, 9])
    expect(series[1]?.xValues).toEqual([1, 2])
  })

  it('writes an emptied x as a gap, as it does a value', () => {
    const written = writeXValuesIn(SCATTER, { series: 0, xValues: [null, 2] }) ?? ''
    expect(allSeries(readChart(written) ?? ({ plots: [] } as never))[0]?.xValues).toEqual([null, 2])
  })
})
