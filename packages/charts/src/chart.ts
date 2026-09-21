import {
  attribute,
  children,
  findChild,
  findDescendant,
  parseXml,
  tagName,
  TEXT_KEY,
  textValue,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { readShapeProperties } from '@orangery/ooxml-drawingml'
import type { Color, ShapeProperties } from '@orangery/ooxml-drawingml'

/**
 * `c:chartSpace` — a chart, read from its cached values.
 *
 * Every series points at a range in a workbook — embedded in the package for a
 * deck or a document, the sheet itself for a spreadsheet — and beside that
 * reference sits a cache of what the range held when the chart was last built.
 * **The cache is what to draw.** Office draws from it too until someone edits
 * the data, which is why a chart still renders in a file whose workbook has
 * been stripped.
 *
 * The reference is read as well as the cache, because an app that owns the
 * cells behind a chart has to know which ones they are — that is the whole
 * difference between a chart in a deck and a chart in a sheet
 * (`apps/sheets/docs/adr/0001-charts-model.md`).
 *
 * The node the chart was parsed from is kept beside the model. Saving patches
 * that node rather than rebuilding it, so a chart carries back every element we
 * do not model: its effects, its per-point formatting, its `c:extLst`.
 */

export type ChartKind =
  'bar' | 'line' | 'pie' | 'doughnut' | 'scatter' | 'area' | 'radar' | 'unsupported'

/**
 * The groups we draw.
 *
 * The 3-D variants map to their flat counterparts on purpose: a flat drawing
 * reads the same numbers, and the markup is preserved, so Excel and PowerPoint
 * still show the file in three dimensions.
 */
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
  'c:radarChart': 'radar',
}

/** The groups we recognise and do not draw, by the name to put on the frame. */
const UNDRAWN: Readonly<Record<string, string>> = {
  'c:stockChart': 'Stock chart',
  'c:surfaceChart': 'Surface chart',
  'c:surface3DChart': 'Surface chart',
  'c:bubbleChart': 'Bubble chart',
  'c:ofPieChart': 'Pie of pie chart',
}

/**
 * `cx:chartSpace` — the charts Excel 2016 added, by the layout each names.
 *
 * A different namespace with a different schema, in which the data lives in
 * `cx:chartData` rather than beside each series. None of it is modelled, so the
 * part is read only far enough to say what kind of chart is being stood in for.
 */
const CHART_EX: Readonly<Record<string, string>> = {
  boxWhisker: 'Box and whisker chart',
  clusteredColumn: 'Histogram',
  funnel: 'Funnel chart',
  paretoLine: 'Pareto chart',
  regionMap: 'Map chart',
  sunburst: 'Sunburst chart',
  treemap: 'Treemap chart',
  waterfall: 'Waterfall chart',
}

/** Where a series' numbers live, as the chart states it: `Sheet1!$B$2:$B$5`. */
export type CellRange = string | null

export interface ChartMarker {
  /** `circle`, `square`, `diamond`… and `none`, which is how a line says it has none. */
  symbol: string
  size: number | null
}

/** A point formatted differently from the rest of its series, as pie slices are. */
export interface DataPoint {
  index: number
  /** The solid fill, which is what a point almost always states. */
  color: Color | null
  properties: ShapeProperties | null
}

/**
 * A line fitted through a series.
 *
 * Read, not computed: the file says which fit was asked for, and the numbers
 * behind it are the series itself. Computing it is the renderer's job.
 */
export interface Trendline {
  /** `linear`, `poly`, `exp`, `log`, `power`, `movingAvg`. */
  kind: string
  /** The degree of a polynomial fit; the span of a moving average. */
  order: number | null
  period: number | null
  /** How far the line is carried past the data, in categories. */
  forward: number | null
  backward: number | null
  showEquation: boolean
  showR2: boolean
  name: string | null
}

/** How far a point might be out, drawn as whiskers on it. */
export interface ErrorBars {
  /** `x` or `y`; a scatter can have both, one element each. */
  direction: string | null
  /** `both`, `plus`, `minus`. */
  kind: string | null
  /** `fixedVal`, `percentage`, `stdDev`, `stdErr`, `cust`. */
  valueType: string | null
  /** The amount, for every type but `cust`, which names cells instead. */
  value: number | null
}

export interface ChartSeries {
  /** From `c:tx`, the cached series name. Null for a chart that names none. */
  name: string | null
  /** The cell the name came from, for an app that owns those cells. */
  nameRef: CellRange
  /**
   * One entry per point, in category order.
   *
   * Null where the chart has a gap: points are written with an `idx` and a
   * sparse series is normal, so a reader that pushes values in document order
   * silently shifts every point after the gap.
   */
  values: (number | null)[]
  valuesRef: CellRange
  categoriesRef: CellRange
  /**
   * Where each point sits along the bottom, for a scatter.
   *
   * Null for every other kind, where the bottom is a list of categories rather
   * than a number line. A scatter states these per series, not once for the
   * chart: two series can be measured at different places, which is most of
   * what a scatter is for.
   */
  xValues: (number | null)[] | null
  xValuesRef: CellRange
  /**
   * The solid fill the series states, which is what charts almost always
   * state. The whole of `c:spPr` — gradients, the line, the effects — is in
   * `properties`; this is the one question the renderer asks most.
   */
  color: Color | null
  properties: ShapeProperties | null
  /**
   * Where the series sits in the legend (`c:order`) and which colour it takes
   * (`c:idx`). They usually agree, and a chart whose series were reordered is
   * where they stop agreeing.
   */
  index: number | null
  order: number | null
  marker: ChartMarker | null
  /** A line drawn as a curve through its points rather than as segments. */
  smooth: boolean
  /** Points that say something different from their series, by index. */
  points: DataPoint[]
  /** What this series labels its points with, where it overrides its group. */
  labels: DataLabels | null
  /** Usually none; a series can carry more than one fit at a time. */
  trendlines: Trendline[]
  errorBars: ErrorBars[]
}

/** What each point says about itself, beyond being drawn. */
export interface DataLabels {
  values: boolean
  categories: boolean
  /** A share rather than a number, which only a pie can mean. */
  percentages: boolean
  /** The series name, which a chart with one series often shows instead of a legend. */
  seriesName: boolean
}

const NO_LABELS: DataLabels = {
  values: false,
  categories: false,
  percentages: false,
  seriesName: false,
}

export type AxisKind = 'category' | 'value' | 'date'

/**
 * One axis of the plot area.
 *
 * Read even when it is deleted: `c:delete` hides the axis, it does not remove
 * the scale, and a chart whose value axis starts at 40 is a chart drawn
 * differently whether or not anybody can see the numbers.
 */
export interface ChartAxis {
  /** `c:axId`, which is how a group says which axes it is measured against. */
  id: string
  kind: AxisKind
  /** `b`, `l`, `t`, `r` — where it sits, which is not implied by its kind. */
  position: string | null
  /** A `numFmt` code, applied to the tick labels and to any data label on this scale. */
  numberFormat: string | null
  title: string | null
  min: number | null
  max: number | null
  majorUnit: number | null
  minorUnit: number | null
  logBase: number | null
  /** `c:orientation` of `maxMin`: the scale runs the other way. */
  reversed: boolean
  /** `c:delete`: the scale still applies, the axis is simply not drawn. */
  hidden: boolean
  majorGridlines: boolean
  /** Where the other axis cuts this one, when the chart says so outright. */
  crossesAt: number | null
  /** Whether this axis belongs to the second pair rather than the first. */
  secondary: boolean
}

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
  /** What to call a group we do not draw; null for one we do. */
  label: string | null
  /** `col` for a column chart, `bar` for a horizontal one. */
  direction: string | null
  /** `clustered`, `stacked`, `percentStacked`. */
  grouping: string | null
  /** `lineMarker`, `marker`, `smoothMarker` — whether a scatter joins its points. */
  scatterStyle: string | null
  /** `standard` or `filled`, which is whether a radar is an outline or an area. */
  radarStyle: string | null
  series: ChartSeries[]
  labels: DataLabels
  /** A chart that colours each point rather than each series, as a pie does. */
  varyColors: boolean
  /** The gap between categories as a percentage of the bar width; Office defaults to 150. */
  gapWidth: number | null
  /** How far bars in a category overlap: -27 clustered, 100 stacked, in Office's own files. */
  overlap: number | null
  /** The hole in a doughnut, as a percentage of its diameter. */
  holeSize: number | null
  /** Where a pie starts, in degrees clockwise from twelve o'clock. */
  firstSliceAngle: number | null
  /** The axes this group names, in the order it names them. */
  axisIds: string[]
  /**
   * Whether this group is measured against the axis on the right.
   *
   * Decided by the ids: a group naming none of the first group's axes is
   * plotted against different ones, and there are only ever two pairs.
   */
  secondary: boolean
}

/**
 * Where a chart has been told to put its plot area.
 *
 * The numbers are fractions of the chart's own frame — `0.1` is a tenth of the
 * way across — and they are how somebody who dragged the plot area in Office
 * said where they wanted it. A chart that states none is laid out
 * automatically, which is the ordinary case and the one Office writes for a
 * chart nobody has rearranged.
 *
 * `c:xMode` decides what the number means: `edge` is a position, and the
 * default, `factor`, is an offset from wherever the automatic layout would
 * have put it. An offset can only be applied by something that knows Office's
 * own automatic layout to the pixel, so those are read as null — a chart drawn
 * automatically is a chart drawn nearly right, while one nudged by a
 * misunderstood offset is drawn wrong on purpose.
 */
export interface ManualLayout {
  /** `inner` is the plotting rectangle itself; `outer` includes its labels. */
  target: 'inner' | 'outer'
  x: number | null
  y: number | null
  width: number | null
  height: number | null
}

/** A chart we do not draw, named so its frame can say what is missing. */
export interface UnsupportedChart {
  label: string
}

/** The XML the chart was read from, which saving patches rather than replaces. */
export interface ChartSource {
  /** Everything the part holds, so it can be written back whole. */
  roots: XmlNode[]
  /** The `c:chartSpace`, or the `cx:chartSpace` of a chart we do not model. */
  space: XmlNode
}

/** The grid of numbers some charts print under the plot area. */
export interface DataTable {
  /** Whether each row carries the series' colour beside its name. */
  legendKeys: boolean
}

export interface Chart {
  title: string | null
  /** The names along the bottom; empty for a scatter, which numbers it instead. */
  categories: string[]
  /** One per `c:*Chart` in the plot area; empty for a chart we cannot read. */
  plots: ChartPlot[]
  /** `b`, `t`, `l`, `r`, `tr`; null when the chart shows no legend. */
  legend: string | null
  /** Both pairs, in the order the plot area lists them. */
  axes: ChartAxis[]
  /** Set when there is nothing here we can draw, and the frame has to say so. */
  unsupported: UnsupportedChart | null
  /** The numbers printed under the plot area, where the chart asks for them. */
  dataTable: DataTable | null
  /** Where the plot area was dragged to, or null for the automatic layout. */
  plotLayout: ManualLayout | null
  /**
   * `c:style` — the built-in style, 1 to 48, that Office 2007 charts carry.
   *
   * Newer files say the same thing in a `cs:chartStyle` part instead, which is
   * a part of its own and not read here. Kept because it is what a chart with
   * no explicit colours is coloured by.
   */
  styleId: number | null
  /** `c:dispBlanksAs`: `gap`, `zero` or `span`, which is how a line crosses a hole. */
  blanks: string | null
  source: ChartSource
}

/** Every series in the chart, in the order the groups list them. */
export function allSeries(chart: Chart): ChartSeries[] {
  return chart.plots.flatMap((plot) => plot.series)
}

/** The kind the chart is, which is the kind of its first group. */
export function chartKind(chart: Chart): ChartKind {
  return chart.plots[0]?.kind ?? 'unsupported'
}

/** The axes a group is measured against, which is how a secondary scale is found. */
export function axesOfPlot(chart: Chart, plot: ChartPlot): ChartAxis[] {
  return plot.axisIds.flatMap((id) => {
    const axis = chart.axes.find((one) => one.id === id)
    return axis === undefined ? [] : [axis]
  })
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

  // A multi-level cache keeps its count on the cache and its points a level
  // down, so the two are looked for separately rather than side by side.
  const level = children(cache).find((child) => tagName(child) === 'c:lvl')
  const count = Number(attribute(findChild(cache, 'c:ptCount') ?? {}, 'val'))
  const points = children(level ?? cache).filter((child) => tagName(child) === 'c:pt')
  const size = Number.isFinite(count) ? count : points.length
  const dense: (string | null)[] = Array.from({ length: size }, () => null)

  for (const point of points) {
    const index = Number(attribute(point, 'idx'))
    if (Number.isFinite(index) && index >= 0 && index < size) dense[index] = valueOf(point)
  }

  return dense
}

/**
 * The cache inside a `c:cat`, `c:val` or `c:tx`, whichever kind of reference it is.
 *
 * Categories written in tiers — months under quarters — are a
 * `c:multiLvlStrCache` holding a `c:lvl` per tier, innermost first. The
 * innermost is the one that names the points, and the tiers above it group
 * them; reading past the first would put a quarter's name on a month.
 */
function cacheIn(holder: XmlNode | undefined): XmlNode | undefined {
  if (holder === undefined) return undefined

  return (
    findDescendant(holder, 'c:numCache') ??
    findDescendant(holder, 'c:strCache') ??
    findDescendant(holder, 'c:multiLvlStrCache')
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

/** The range a holder points at — `Sheet1!$B$2:$B$5` — or null where it names none. */
function referenceIn(holder: XmlNode | undefined): CellRange {
  if (holder === undefined) return null

  const formula = findDescendant(holder, 'c:f')
  if (formula === undefined) return null

  const text = children(formula)
    .map((child) => textValue(child))
    .join('')
  return text === '' ? null : text
}

const numberOf = (parent: XmlNode, tag: string): number | null => {
  const value = Number(attribute(findChild(parent, tag) ?? {}, 'val'))
  return Number.isFinite(value) ? value : null
}

const flagged = (node: XmlNode | undefined, tag: string): boolean =>
  node === undefined ? false : attribute(findChild(node, tag) ?? {}, 'val') === '1'

function readMarker(node: XmlNode): ChartMarker | null {
  const marker = findChild(node, 'c:marker')
  if (marker === undefined) return null

  const symbol = attribute(findChild(marker, 'c:symbol') ?? {}, 'val')
  return symbol === undefined ? null : { symbol, size: numberOf(marker, 'c:size') }
}

/**
 * The `c:spPr` of a series or a point, read as any shape's properties are.
 *
 * It is DrawingML inside a chart element — the same fills, the same line, the
 * same effects — so it is read by the package that owns that vocabulary rather
 * than by a second reader here that would know about solid fills only.
 */
function propertiesOf(node: XmlNode): ShapeProperties | null {
  const properties = findChild(node, 'c:spPr')
  return properties === undefined ? null : readShapeProperties(properties)
}

/** The solid fill, which is what a series almost always states. */
const solidFillOf = (properties: ShapeProperties | null): Color | null =>
  properties?.fill?.kind === 'solid' ? properties.fill.color : null

/**
 * Points formatted apart from their series.
 *
 * A pie is the ordinary case: one series, and every slice with a colour of its
 * own. A chart that ignored these would draw a pie in one colour.
 */
function readPoints(node: XmlNode): DataPoint[] {
  return children(node).flatMap((child) => {
    if (tagName(child) !== 'c:dPt') return []

    const index = numberOf(child, 'c:idx')
    const properties = propertiesOf(child)
    return index === null ? [] : [{ index, color: solidFillOf(properties), properties }]
  })
}

/** The name a trendline shows, which is a text body like any other title. */
function trendlineName(node: XmlNode): string | null {
  const name = findChild(node, 'c:name')
  if (name === undefined) return null

  const text = collectText(name)
  return text === '' ? null : text
}

function readTrendlines(node: XmlNode): Trendline[] {
  return children(node).flatMap((child) => {
    if (tagName(child) !== 'c:trendline') return []

    return [
      {
        kind: attribute(findChild(child, 'c:trendlineType') ?? {}, 'val') ?? 'linear',
        order: numberOf(child, 'c:order'),
        period: numberOf(child, 'c:period'),
        forward: numberOf(child, 'c:forward'),
        backward: numberOf(child, 'c:backward'),
        showEquation: flagged(child, 'c:dispEq'),
        showR2: flagged(child, 'c:dispRSqr'),
        name: trendlineName(child),
      },
    ]
  })
}

/**
 * The whiskers on a point.
 *
 * A scatter states two of these, one per direction; everything else states
 * one. They are read as a list for that reason rather than as a single value
 * whose second copy would overwrite the first.
 */
function readErrorBars(node: XmlNode): ErrorBars[] {
  return children(node).flatMap((child) => {
    if (tagName(child) !== 'c:errBars') return []

    return [
      {
        direction: attribute(findChild(child, 'c:errDir') ?? {}, 'val') ?? null,
        kind: attribute(findChild(child, 'c:errBarType') ?? {}, 'val') ?? null,
        valueType: attribute(findChild(child, 'c:errValType') ?? {}, 'val') ?? null,
        value: numberOf(child, 'c:val'),
      },
    ]
  })
}

function readSeries(node: XmlNode, scatter: boolean): ChartSeries {
  const properties = propertiesOf(node)
  const values = findChild(node, 'c:val') ?? findChild(node, 'c:yVal')
  const categories = findChild(node, 'c:cat')
  const xValues = findChild(node, 'c:xVal')
  const name = findChild(node, 'c:tx')

  return {
    name: readCache(cacheIn(name))[0] ?? null,
    nameRef: referenceIn(name),
    values: readNumbers(values),
    valuesRef: referenceIn(values),
    categoriesRef: referenceIn(categories),
    xValues: scatter ? readNumbers(xValues) : null,
    xValuesRef: referenceIn(xValues),
    color: solidFillOf(properties),
    properties,
    index: numberOf(node, 'c:idx'),
    order: numberOf(node, 'c:order'),
    marker: readMarker(node),
    smooth: flagged(node, 'c:smooth'),
    points: readPoints(node),
    labels: findChild(node, 'c:dLbls') === undefined ? null : readLabels(node),
    trendlines: readTrendlines(node),
    errorBars: readErrorBars(node),
  }
}

/** Categories come from the first series; every series repeats the same list. */
function readCategories(series: readonly XmlNode[]): string[] {
  const first = series[0]
  if (first === undefined) return []

  return readCache(cacheIn(findChild(first, 'c:cat'))).map((value) => value ?? '')
}

/**
 * What the points in a group are labelled with.
 *
 * `c:dLbls` also appears inside a series, saying something different about that
 * one, and inside a point saying something about it alone. The group's is what
 * the chart as a whole does.
 */
function readLabels(group: XmlNode): DataLabels {
  const labels = findChild(group, 'c:dLbls')
  if (labels === undefined) return NO_LABELS

  return {
    values: flagged(labels, 'c:showVal'),
    categories: flagged(labels, 'c:showCatName'),
    percentages: flagged(labels, 'c:showPercent'),
    seriesName: flagged(labels, 'c:showSerName'),
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

/** Whether a child of the plot area is a group of series rather than an axis or a layout. */
const isGroup = (node: XmlNode): boolean => (tagName(node) ?? '').endsWith('Chart')

function readPlot(group: XmlNode, primary: readonly string[]): ChartPlot {
  const tag = tagName(group) ?? ''
  const kind = KINDS[tag] ?? 'unsupported'
  const series = children(group).filter((child) => tagName(child) === 'c:ser')
  const axes = axesOf(group)

  return {
    kind,
    label: kind === 'unsupported' ? (UNDRAWN[tag] ?? nameOfTag(tag)) : null,
    direction: attribute(findChild(group, 'c:barDir') ?? {}, 'val') ?? null,
    grouping: attribute(findChild(group, 'c:grouping') ?? {}, 'val') ?? null,
    scatterStyle: attribute(findChild(group, 'c:scatterStyle') ?? {}, 'val') ?? null,
    radarStyle: attribute(findChild(group, 'c:radarStyle') ?? {}, 'val') ?? null,
    series: series.map((one) => readSeries(one, kind === 'scatter')),
    labels: readLabels(group),
    varyColors: flagged(group, 'c:varyColors'),
    gapWidth: numberOf(group, 'c:gapWidth'),
    overlap: numberOf(group, 'c:overlap'),
    holeSize: numberOf(group, 'c:holeSize'),
    firstSliceAngle: numberOf(group, 'c:firstSliceAng'),
    axisIds: axes,
    // Sharing nothing with the first group's pair is the only thing that makes
    // a group secondary; there are never more than two pairs.
    secondary: primary.length > 0 && axes.length > 0 && !axes.some((id) => primary.includes(id)),
  }
}

/** `c:stockChart` as "Stock chart", for a kind nobody has named here yet. */
function nameOfTag(tag: string): string {
  const bare = tag.replace(/^c:/u, '').replace(/Chart$/u, '')
  const spaced = bare.replace(/([a-z])([A-Z0-9])/gu, '$1 $2').toLowerCase()
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)} chart`
}

const AXIS_KINDS: Readonly<Record<string, AxisKind>> = {
  'c:catAx': 'category',
  'c:valAx': 'value',
  'c:dateAx': 'date',
}

function readAxis(node: XmlNode, kind: AxisKind, primary: readonly string[]): ChartAxis {
  const scaling = findChild(node, 'c:scaling')
  const orientation =
    scaling === undefined ? undefined : attribute(findChild(scaling, 'c:orientation') ?? {}, 'val')
  const id = attribute(findChild(node, 'c:axId') ?? {}, 'val') ?? ''

  return {
    id,
    kind,
    position: attribute(findChild(node, 'c:axPos') ?? {}, 'val') ?? null,
    numberFormat: attribute(findChild(node, 'c:numFmt') ?? {}, 'formatCode') ?? null,
    title: readTitleOf(node),
    min: scaling === undefined ? null : numberOf(scaling, 'c:min'),
    max: scaling === undefined ? null : numberOf(scaling, 'c:max'),
    majorUnit: numberOf(node, 'c:majorUnit'),
    minorUnit: numberOf(node, 'c:minorUnit'),
    logBase: scaling === undefined ? null : numberOf(scaling, 'c:logBase'),
    reversed: orientation === 'maxMin',
    hidden: flagged(node, 'c:delete'),
    majorGridlines: findChild(node, 'c:majorGridlines') !== undefined,
    crossesAt: numberOf(node, 'c:crossesAt'),
    secondary: primary.length > 0 && !primary.includes(id),
  }
}

export function readChart(xml: string): Chart | null {
  const roots = parseXml(xml)
  const space = roots.find((node) => tagName(node) === 'c:chartSpace')
  if (space === undefined) return readChartEx(roots)

  const chart = findChild(space, 'c:chart')
  const plot = chart === undefined ? undefined : findChild(chart, 'c:plotArea')
  if (plot === undefined) return null

  const groups = children(plot).filter((child) => isGroup(child))
  const primary = groups[0] === undefined ? [] : axesOf(groups[0])
  const plots = groups.map((group) => readPlot(group, primary))
  const drawable = plots.filter((one) => one.kind !== 'unsupported')

  // A plot area we do not recognise still tells the caller there is a chart
  // there, so it can be framed and labelled rather than left blank.
  return {
    title: readTitleOf(chart ?? space),
    categories: readCategories(
      groups.flatMap((group) => children(group).filter((child) => tagName(child) === 'c:ser')),
    ),
    plots,
    legend: readLegend(chart),
    axes: children(plot).flatMap((child) => {
      const kind = AXIS_KINDS[tagName(child) ?? '']
      return kind === undefined ? [] : [readAxis(child, kind, primary)]
    }),
    unsupported: drawable.length > 0 ? null : { label: plots[0]?.label ?? 'Chart' },
    dataTable:
      findChild(plot, 'c:dTable') === undefined
        ? null
        : { legendKeys: flagged(findChild(plot, 'c:dTable'), 'c:showLegendKey') },
    plotLayout: readLayout(findChild(plot, 'c:layout')),
    styleId: numberOf(space, 'c:style'),
    blanks:
      chart === undefined
        ? null
        : (attribute(findChild(chart, 'c:dispBlanksAs') ?? {}, 'val') ?? null),
    source: { roots, space },
  }
}

/**
 * A stated position, or null where the chart states an offset instead.
 *
 * The mode attribute sits on the layout, one per value: `c:xMode` for `c:x`
 * and so on, each defaulting to `factor`.
 */
function edgeValue(layout: XmlNode, value: string, mode: string): number | null {
  if (attribute(findChild(layout, mode) ?? {}, 'val') !== 'edge') return null

  const stated = Number(attribute(findChild(layout, value) ?? {}, 'val'))
  return Number.isFinite(stated) ? stated : null
}

function readLayout(node: XmlNode | undefined): ManualLayout | null {
  const manual = node === undefined ? undefined : findChild(node, 'c:manualLayout')
  if (manual === undefined) return null

  return {
    target:
      attribute(findChild(manual, 'c:layoutTarget') ?? {}, 'val') === 'inner' ? 'inner' : 'outer',
    x: edgeValue(manual, 'c:x', 'c:xMode'),
    y: edgeValue(manual, 'c:y', 'c:yMode'),
    // Width and height have modes of their own, and a chart that states a
    // position without a size is ordinary.
    width: edgeValue(manual, 'c:w', 'c:wMode'),
    height: edgeValue(manual, 'c:h', 'c:hMode'),
  }
}

/**
 * A `cx:chartSpace`, read only far enough to name what it is.
 *
 * Nothing about this namespace is modelled and nothing about it is written, so
 * what comes back is a chart with no plots and a label — enough for a frame
 * that says "Waterfall chart" where a waterfall belongs. Drawing one as bars
 * would put wrong numbers on the slide, which is worse than an empty frame.
 */
function readChartEx(roots: readonly XmlNode[]): Chart | null {
  const space = roots.find((node) => tagName(node) === 'cx:chartSpace')
  if (space === undefined) return null

  const series = findDescendant(space, 'cx:series')
  const layout = series === undefined ? undefined : attribute(series, 'layoutId')

  return {
    title: null,
    categories: [],
    plots: [],
    legend: null,
    axes: [],
    unsupported: { label: (layout === undefined ? undefined : CHART_EX[layout]) ?? 'Chart' },
    dataTable: null,
    plotLayout: null,
    styleId: null,
    blanks: null,
    source: { roots: [...roots], space },
  }
}

/**
 * The title of a chart or of an axis, which are the same element.
 *
 * Either written out in the file as a text body, or pointed at a cell — a
 * title that reads itself from a heading is a title whose words are in the
 * cache beside the reference, not in the chart.
 */
function readTitleOf(parent: XmlNode | undefined): string | null {
  const title = parent === undefined ? undefined : findChild(parent, 'c:title')
  if (title === undefined) return null

  // Either written out as a text body, or pointed at a cell whose words are in
  // the cache beside the reference rather than in the chart.
  const body = findDescendant(title, 'c:rich')
  const text =
    body === undefined ? (readCache(cacheIn(findChild(title, 'c:tx')))[0] ?? '') : collectText(body)
  return text === '' ? null : text
}

/**
 * The words in a text body, across however many runs they are split into.
 *
 * A text node is `{ '#text': 'Revenue' }`, and its key is a tag name like any
 * other as far as the reader is concerned — so it has to be named here. Testing
 * for a node without a tag instead finds nothing, and every title reads as
 * empty.
 */
function collectText(node: XmlNode): string {
  const tag = tagName(node)
  if (tag === null || tag === TEXT_KEY) return textValue(node)

  return children(node)
    .map((child) => collectText(child))
    .join('')
}

function readLegend(chart: XmlNode | undefined): string | null {
  const legend = chart === undefined ? undefined : findChild(chart, 'c:legend')
  if (legend === undefined) return null

  return attribute(findChild(legend, 'c:legendPos') ?? {}, 'val') ?? 'r'
}
