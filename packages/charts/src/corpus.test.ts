import { describe, expect, it } from 'vitest'
import {
  buildXml,
  compareXml,
  describeDifferences,
  parseXml,
  withDeclaration,
} from '@orangery/ooxml-core'
import { allSeries, chartKind, readChart } from './chart'
import { applyChartEdits } from './chart-edit'
import { corpusDirectory, readCorpus } from './corpus'

/**
 * Every chart in every real file somebody has put in the corpus.
 *
 * The synthetic fixtures ask whether an element parses. These ask the question
 * that cannot be asked of a file we wrote ourselves: whether a chart made by
 * PowerPoint, Excel, Google or LibreOffice survives being opened and saved.
 *
 * With no corpus the suite says so and passes, which is what lets this live in
 * the repository before the files do — see `tests/fixtures/office/README.md`.
 */

const charts = await readCorpus()
const named = charts.map((chart) => `${chart.file} ${chart.part}`)

/**
 * Charts in the corpus that this does not hold to its own standard yet.
 *
 * Each one is a bug with an issue, and the entry says which: a corpus test
 * that fails is a `pnpm check` that fails, and a check that is red for a known
 * reason is a check people stop reading. They are named rather than counted so
 * that the list is uncomfortable to leave alone, and so that a fix removes a
 * line here rather than quietly changing a number.
 *
 * See https://github.com/HutsuliakDmytro/orangery/issues/10.
 */
const KNOWN: { chart: string; test: string }[] = [
  { chart: 'word2016win-charts-01.docx word/charts/chart4.xml', test: 'legend' },
  { chart: 'word2016win-charts-01.docx word/charts/chart6.xml', test: 'legend' },
  { chart: 'word2016win-charts-01.docx word/charts/chart4.xml', test: 'series' },
  { chart: 'word2016win-charts-01.docx word/charts/chart6.xml', test: 'series' },
  { chart: 'excel2013win-charts-01.xlsx xl/charts/chart1.xml', test: 'series' },
]

const known = (name: string, test: string): boolean =>
  KNOWN.some((one) => one.chart === name && one.test === test)

describe.skipIf(charts.length === 0)('the chart corpus', () => {
  it('was found where it is expected', () => {
    expect(charts.length).toBeGreaterThan(0)
  })

  it('says which charts it is letting off, and why', () => {
    // A corpus somebody points `ORANGERY_CORPUS` at has none of these files in
    // it, and an entry that matches nothing is a fix that forgot to remove it.
    const stale = KNOWN.filter((one) => !named.includes(one.chart) && named.length > 100)
    expect(stale).toEqual([])
  })

  it.each(named)('parses: %s', (name) => {
    const chart = charts.find((one) => `${one.file} ${one.part}` === name)
    const read = readChart(chart?.xml ?? '')

    // Null means the part holds nothing we recognise as a chart at all, which
    // for a file Office wrote is a reader that is wrong rather than a file
    // that is odd.
    expect(read).not.toBeNull()
    expect(chartKind(read ?? ({ plots: [] } as never))).toBeTruthy()
  })

  it.each(named)('is not rewritten when nothing is edited: %s', (name) => {
    const chart = charts.find((one) => `${one.file} ${one.part}` === name)
    expect(applyChartEdits(chart?.xml ?? '', [])).toBeNull()
  })

  it.each(named)('survives being read and written unchanged: %s', (name) => {
    // The path a chart takes when something else in it is edited. Anything the
    // writer loses here, every edit loses.
    const chart = charts.find((one) => `${one.file} ${one.part}` === name)
    const before = chart?.xml ?? ''
    const after = withDeclaration(buildXml(parseXml(before)))

    expect(describeDifferences(compareXml(before, after))).toBe('no differences')
  })

  it.each(named.filter((name) => !known(name, 'legend')))(
    'keeps its numbers when something else is edited: %s',
    (name) => {
      const chart = charts.find((one) => `${one.file} ${one.part}` === name)
      const before = chart?.xml ?? ''
      const after = applyChartEdits(before, [{ kind: 'legend', position: 't' }]) ?? ''

      // Asked of the model rather than of the diff: a legend inserted into a
      // chart that had none shifts its siblings, and a positional comparison
      // calls that a change to every element after it. What matters is that the
      // data did not move.
      const numbers = (xml: string) =>
        (readChart(xml)?.plots ?? []).flatMap((plot) =>
          plot.series.map((series) =>
            [series.name, series.valuesRef, series.values.join()].join('|'),
          ),
        )

      expect(readChart(after)?.legend).toBe('t')
      expect(numbers(after)).toEqual(numbers(before))
    },
  )

  it('draws something for every chart that is not one we frame', () => {
    const drawable = charts.filter(
      (chart) =>
        readChart(chart.xml)?.unsupported === null &&
        !known(`${chart.file} ${chart.part}`, 'series'),
    )

    for (const chart of drawable) {
      const read = readChart(chart.xml)
      const series = read === null ? [] : allSeries(read)

      // A chart with no series at all would render as an empty frame with no
      // label, which is the one outcome worse than saying "unsupported".
      expect(series.length, `${chart.file} ${chart.part}`).toBeGreaterThan(0)
    }
  })
})

describe.runIf(charts.length === 0)('no corpus', () => {
  it('says where to put one rather than passing in silence', () => {
    // Not a failure: a checkout nobody has added files to is the ordinary
    // case. The message is the point.
    expect(corpusDirectory()).toContain('fixtures')
  })
})
