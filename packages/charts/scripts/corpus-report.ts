import { allSeries, chartKind, readChart } from '../src/chart'
import { corpusDirectory, readCorpus } from '../src/corpus'
import type { Chart } from '../src/chart'

/**
 * What a corpus of real files actually holds.
 *
 * Not a test: a test says pass or fail, and the question here is what to build
 * next. Which kinds appear, which ones we frame rather than draw, which parts
 * nobody models — the answer decides where the next week goes, and guessing at
 * it is how a renderer ends up excellent at radar charts nobody uses.
 *
 * `pnpm --filter charts corpus`
 */

const counted = (values: readonly string[]): [string, number][] =>
  [
    ...values.reduce(
      (tally, value) => tally.set(value, (tally.get(value) ?? 0) + 1),
      new Map<string, number>(),
    ),
  ].sort((a, b) => b[1] - a[1])

const line = (label: string, tally: readonly [string, number][]): string =>
  tally.length === 0
    ? `${label}: none`
    : `${label}: ${tally.map(([name, count]) => `${name} ${String(count)}`).join(', ')}`

/** What a chart carries that this package does not model, by element. */
function unmodelled(xml: string): string[] {
  const found = new Set<string>()

  for (const tag of [
    'c:trendline',
    'c:errBars',
    'c:dTable',
    'c:view3D',
    'c:pivotFmts',
    'c:extLst',
  ]) {
    if (xml.includes(`<${tag}`)) found.add(tag)
  }
  if (xml.includes('cs:chartStyle') || xml.includes('mc:AlternateContent'))
    found.add('cs:chartStyle')

  return [...found]
}

const features = (chart: Chart): string[] => [
  ...(chart.title === null ? [] : ['title']),
  ...(chart.legend === null ? [] : ['legend']),
  ...(chart.plots.some((plot) => plot.secondary) ? ['secondary axis'] : []),
  ...(chart.plots.length > 1 ? ['combination'] : []),
  ...(chart.axes.some((axis) => axis.kind === 'date') ? ['date axis'] : []),
  ...(chart.axes.some((axis) => axis.numberFormat !== null) ? ['number format'] : []),
  ...(chart.plots.some((plot) => plot.series.some((series) => series.trendlines.length > 0))
    ? ['trendline']
    : []),
  ...(chart.plots.some((plot) => plot.series.some((series) => series.points.length > 0))
    ? ['per-point colour']
    : []),
  ...(chart.plotLayout === null ? [] : ['manual layout']),
]

const report = async (): Promise<void> => {
  const charts = await readCorpus()

  if (charts.length === 0) {
    console.log(`No files in ${corpusDirectory()}.`)
    console.log('See tests/fixtures/office/README.md for what to put there.')
    return
  }

  const files = new Set(charts.map((chart) => chart.file))
  console.log(`${String(charts.length)} charts in ${String(files.size)} files\n`)

  const read = charts.map((chart) => ({ ...chart, chart: readChart(chart.xml) }))

  console.log(
    line(
      'kinds',
      counted(read.map((one) => (one.chart === null ? 'unreadable' : chartKind(one.chart)))),
    ),
  )
  console.log(
    line(
      'framed rather than drawn',
      counted(
        read.flatMap((one) =>
          one.chart?.unsupported === null ? [] : [one.chart?.unsupported?.label ?? 'unknown'],
        ),
      ),
    ),
  )
  console.log(
    line(
      'features',
      counted(read.flatMap((one) => (one.chart === null ? [] : features(one.chart)))),
    ),
  )
  console.log(line('not modelled', counted(read.flatMap((one) => unmodelled(one.xml)))))

  const empty = read.filter((one) => one.chart !== null && allSeries(one.chart).length === 0)
  if (empty.length > 0) {
    console.log(
      `\ncharts with no series read: ${empty.map((one) => `${one.file} ${one.part}`).join(', ')}`,
    )
  }
}

await report()
