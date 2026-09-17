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
  /** Stated per series; charts usually leave it to the theme. */
  color: Color | null
}

export interface Chart {
  kind: ChartKind
  /** `col` for a column chart, `bar` for a horizontal one. */
  direction: string | null
  /** `clustered`, `stacked`, `percentStacked`. */
  grouping: string | null
  title: string | null
  categories: string[]
  series: ChartSeries[]
  /** `b`, `t`, `l`, `r`, `tr`; null when the chart shows no legend. */
  legend: string | null
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

function readSeries(node: XmlNode): ChartSeries {
  const properties = findChild(node, 'c:spPr')
  const fill = properties === undefined ? undefined : findChild(properties, 'a:solidFill')

  return {
    name: readCache(cacheIn(findChild(node, 'c:tx')))[0] ?? null,
    values: readCache(cacheIn(findChild(node, 'c:val') ?? findChild(node, 'c:yVal'))).map(
      (value) => {
        if (value === null) return null
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
      },
    ),
    color: fill === undefined ? null : readColorChild(fill),
  }
}

/** Categories come from the first series; every series repeats the same list. */
function readCategories(series: readonly XmlNode[]): string[] {
  const first = series[0]
  if (first === undefined) return []

  const holder = findChild(first, 'c:cat') ?? findChild(first, 'c:xVal')
  return readCache(cacheIn(holder)).map((value) => value ?? '')
}

export function readChart(xml: string): Chart | null {
  const space = parseXml(xml).find((node) => tagName(node) === 'c:chartSpace')
  const chart = space === undefined ? undefined : findChild(space, 'c:chart')
  const plot = chart === undefined ? undefined : findChild(chart, 'c:plotArea')
  if (plot === undefined) return null

  const group = children(plot).find((child) => (tagName(child) ?? '') in KINDS)
  if (group === undefined) {
    // A plot area we do not recognise still tells the caller there is a chart
    // there, so it can be framed and labelled rather than left blank.
    return {
      kind: 'unknown',
      direction: null,
      grouping: null,
      title: readTitle(chart),
      categories: [],
      series: [],
      legend: readLegend(chart),
    }
  }

  const series = children(group).filter((child) => tagName(child) === 'c:ser')

  return {
    kind: KINDS[tagName(group) ?? ''] ?? 'unknown',
    direction: attribute(findChild(group, 'c:barDir') ?? {}, 'val') ?? null,
    grouping: attribute(findChild(group, 'c:grouping') ?? {}, 'val') ?? null,
    title: readTitle(chart),
    categories: readCategories(series),
    series: series.map(readSeries),
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
