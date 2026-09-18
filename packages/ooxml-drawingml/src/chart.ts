import {
  attribute,
  children,
  findChild,
  findDescendant,
  parseXml,
  tagName,
  textValue,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { readColorChild } from './color'
import type { Color } from './color'

/**
 * `c:chartSpace` — a chart, read from its cached values.
 *
 * Every series points at a range in a workbook embedded in the package, and
 * beside that reference sits a cache of what the range held when the chart was
 * last built. **The cache is what to draw.** PowerPoint draws from it too until
 * someone edits the data, which is why a chart still renders in a file whose
 * workbook has been stripped — and why we can show charts without opening
 * a spreadsheet.
 *
 * Read only. Nothing here is written back: a chart's part is preserved whole
 * (`apps/slides/docs/adr/0002-pptx-roundtrip.md`), so editing the data is a
 * later phase and there is no path by which this could produce `c:*` markup.
 */

export type ChartKind = 'bar' | 'line' | 'pie' | 'doughnut' | 'scatter' | 'area' | 'unknown'

const KINDS: Readonly<Record<string, ChartKind>> = {
  'c:barChart': 'bar',
  'c:bar3DChart': 'bar',
  'c:lineChart': 'line',
  'c:line3DChart': 'line',
  'c:pieChart': 'pie',
  'c:pie3DChart': 'pie',
  'c:doughnutChart': 'doughnut',
  'c:scatterChart': 'scatter',
  'c:areaChart': 'area',
  'c:area3DChart': 'area',
}

export interface ChartSeries {
  /** From `c:tx`, the cached series name. Null for a chart that names none. */
  name: string | null
  /**
   * One entry per point, in category order.
   *
   * Null where the chart has a gap: points are written with an `idx` and a
   * sparse series is normal, so a reader that pushes values in document order
   * silently shifts every point after the gap.
   */
  values: (number | null)[]
  /**
   * Where each point sits along the bottom, for a scatter.
   *
   * Null for every other kind, where the bottom is a list of categories rather
   * than a number line. A scatter states these per series, not once for the
   * chart: two series can be measured at different places, which is most of
   * what a scatter is for.
   */
  xValues: (number | null)[] | null
  /** Stated per series; charts usually leave it to the theme. */
  color: Color | null
}

/** What each point says about itself, beyond being drawn. */
export interface DataLabels {
  values: boolean
  categories: boolean
  /** A share rather than a number, which only a pie can mean. */
  percentages: boolean
}

const NO_LABELS: DataLabels = { values: false, categories: false, percentages: false }

/**
 * One `c:*Chart` in the plot area.
 *
 * A chart can hold more than one. Columns with a line over them is two groups
 * in one plot area, and the second is usually measured against an axis of its
 * own — a revenue in millions beside a margin in percent, where one scale for
 * both would draw the margin as a flat line along the bottom.
 */
export interface ChartPlot {
  kind: ChartKind
  /** `col` for a column chart, `bar` for a horizontal one. */
  direction: string | null
  /** `clustered`, `stacked`, `percentStacked`. */
  grouping: string | null
  /** `lineMarker`, `marker`, `smoothMarker` — whether a scatter joins its points. */
  scatterStyle: string | null
  series: ChartSeries[]
  labels: DataLabels
  /**
   * Whether this group is measured against the axis on the right.
   *
   * Decided by the ids: a group naming none of the first group's axes is
   * plotted against different ones, and there are only ever two pairs.
   */
  secondary: boolean
}

export interface Chart {
  title: string | null
  /** The names along the bottom; empty for a scatter, which numbers it instead. */
  categories: string[]
  /** One per `c:*Chart` in the plot area; empty for a chart we cannot read. */
  plots: ChartPlot[]
  /** `b`, `t`, `l`, `r`, `tr`; null when the chart shows no legend. */
  legend: string | null
}

/** Every series in the chart, in the order the groups list them. */
export function allSeries(chart: Chart): ChartSeries[] {
  return chart.plots.flatMap((plot) => plot.series)
}

/** The kind the chart is, which is the kind of its first group. */
export function chartKind(chart: Chart): ChartKind {
  return chart.plots[0]?.kind ?? 'unknown'
}

/** The text of a `c:v`, which holds its value as a child node. */
function valueOf(point: XmlNode): string {
  const value = findChild(point, 'c:v')
  return value === undefined
    ? ''
    : children(value)
        .map((child) => textValue(child))
        .join('')
}

/**
 * Reads a cache into a dense array of the length the cache declares.
 *
 * `c:ptCount` is the authority on how many points there are; `c:pt` carries an
 * `idx` and may skip.
 */
function readCache(cache: XmlNode | undefined): (string | null)[] {
  if (cache === undefined) return []

  const count = Number(attribute(findChild(cache, 'c:ptCount') ?? {}, 'val'))
  const points = children(cache).filter((child) => tagName(child) === 'c:pt')
  const size = Number.isFinite(count) ? count : points.length
  const dense: (string | null)[] = Array.from({ length: size }, () => null)

  for (const point of points) {
    const index = Number(attribute(point, 'idx'))
    if (Number.isFinite(index) && index >= 0 && index < size) dense[index] = valueOf(point)
  }

  return dense
}

/** The cache inside a `c:cat`, `c:val` or `c:tx`, whichever kind of reference it is. */
function cacheIn(holder: XmlNode | undefined): XmlNode | undefined {
  if (holder === undefined) return undefined
  return (
    findDescendant(holder, 'c:numCache') ??
    findDescendant(holder, 'c:strCache') ??
    findDescendant(holder, 'c:multiLvlStrRef')
  )
}

/** Reads a cache of numbers, leaving the blanks blank. */
function readNumbers(holder: XmlNode | undefined): (number | null)[] {
  return readCache(cacheIn(holder)).map((value) => {
    if (value === null) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  })
}

function readSeries(node: XmlNode, scatter: boolean): ChartSeries {
  const properties = findChild(node, 'c:spPr')
  const fill = properties === undefined ? undefined : findChild(properties, 'a:solidFill')

  return {
    name: readCache(cacheIn(findChild(node, 'c:tx')))[0] ?? null,
    values: readNumbers(findChild(node, 'c:val') ?? findChild(node, 'c:yVal')),
    xValues: scatter ? readNumbers(findChild(node, 'c:xVal')) : null,
    color: fill === undefined ? null : readColorChild(fill),
  }
}

/** Categories come from the first series; every series repeats the same list. */
function readCategories(series: readonly XmlNode[]): string[] {
  const first = series[0]
  if (first === undefined) return []

  return readCache(cacheIn(findChild(first, 'c:cat'))).map((value) => value ?? '')
}

const flagged = (node: XmlNode | undefined, tag: string): boolean =>
  node === undefined ? false : attribute(findChild(node, tag) ?? {}, 'val') === '1'

/**
 * What the points in a group are labelled with.
 *
 * `c:dLbls` also appears inside a series, saying something different about that
 * one; the group's is what the chart as a whole does, and is the question worth
 * answering before per-series overrides exist.
 */
function readLabels(group: XmlNode): DataLabels {
  const labels = findChild(group, 'c:dLbls')
  if (labels === undefined) return NO_LABELS

  return {
    values: flagged(labels, 'c:showVal'),
    categories: flagged(labels, 'c:showCatName'),
    percentages: flagged(labels, 'c:showPercent'),
  }
}

/** The axes a group names, which is how two groups say they are not on the same one. */
const axesOf = (group: XmlNode): string[] =>
  children(group)
    .filter((child) => tagName(child) === 'c:axId')
    .flatMap((child) => {
      const id = attribute(child, 'val')
      return id === undefined ? [] : [id]
    })

function readPlot(group: XmlNode, primary: readonly string[]): ChartPlot {
  const kind = KINDS[tagName(group) ?? ''] ?? 'unknown'
  const series = children(group).filter((child) => tagName(child) === 'c:ser')
  const axes = axesOf(group)

  return {
    kind,
    direction: attribute(findChild(group, 'c:barDir') ?? {}, 'val') ?? null,
    grouping: attribute(findChild(group, 'c:grouping') ?? {}, 'val') ?? null,
    scatterStyle: attribute(findChild(group, 'c:scatterStyle') ?? {}, 'val') ?? null,
    series: series.map((one) => readSeries(one, kind === 'scatter')),
    labels: readLabels(group),
    // Sharing nothing with the first group's pair is the only thing that makes
    // a group secondary; there are never more than two pairs.
    secondary: primary.length > 0 && axes.length > 0 && !axes.some((id) => primary.includes(id)),
  }
}

export function readChart(xml: string): Chart | null {
  const space = parseXml(xml).find((node) => tagName(node) === 'c:chartSpace')
  const chart = space === undefined ? undefined : findChild(space, 'c:chart')
  const plot = chart === undefined ? undefined : findChild(chart, 'c:plotArea')
  if (plot === undefined) return null

  const groups = children(plot).filter((child) => (tagName(child) ?? '') in KINDS)
  const primary = groups[0] === undefined ? [] : axesOf(groups[0])

  // A plot area we do not recognise still tells the caller there is a chart
  // there, so it can be framed and labelled rather than left blank.
  return {
    title: readTitle(chart),
    categories: readCategories(
      groups.flatMap((group) => children(group).filter((child) => tagName(child) === 'c:ser')),
    ),
    plots: groups.map((group) => readPlot(group, primary)),
    legend: readLegend(chart),
  }
}

function readTitle(chart: XmlNode | undefined): string | null {
  const title = chart === undefined ? undefined : findChild(chart, 'c:title')
  if (title === undefined) return null

  // The title is a text body, so its words are spread across runs.
  const body = findDescendant(title, 'c:rich')
  if (body === undefined) return null

  const text = collectText(body)
  return text === '' ? null : text
}

function collectText(node: XmlNode): string {
  return children(node)
    .map((child) => (tagName(child) === null ? textValue(child) : collectText(child)))
    .join('')
}

function readLegend(chart: XmlNode | undefined): string | null {
  const legend = chart === undefined ? undefined : findChild(chart, 'c:legend')
  if (legend === undefined) return null

  return attribute(findChild(legend, 'c:legendPos') ?? {}, 'val') ?? 'r'
}
