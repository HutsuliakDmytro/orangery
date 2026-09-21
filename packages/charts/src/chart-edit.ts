import {
  attribute,
  buildXml,
  children,
  element,
  findChild,
  parseXml,
  removeChild,
  tagName,
  upsertChild,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { Color } from '@orangery/ooxml-drawingml'
import type { ChartKind } from './chart'

/**
 * Changing a chart without rewriting it.
 *
 * Every edit here patches the `c:chartSpace` the file already had. Nothing is
 * regenerated, because what a real chart carries — `c:extLst` with the style
 * id, per-point formatting, `c:txPr` on every label, a `cs:chartStyle` the part
 * points at — is larger than what is modelled, and a chart rebuilt from the
 * model would lose all of it on the first save of a file somebody only looked
 * at (`apps/sheets/docs/adr/0001-charts-model.md`).
 *
 * **Order is part of the format.** `c:chart` wants its title before its plot
 * area and its legend after it; `a:spPr` wants a fill before a line. An element
 * in the wrong place makes Excel offer to repair the file, so new ones go in
 * through `upsertChild` with the schema's own sequence.
 */

/** `c:chart`, the elements around the plot area. */
const CHART = [
  'c:title',
  'c:autoTitleDeleted',
  'c:pivotFmts',
  'c:view3D',
  'c:floor',
  'c:sideWall',
  'c:backWall',
  'c:plotArea',
  'c:legend',
  'c:plotVisOnly',
  'c:dispBlanksAs',
  'c:dLbls',
  'c:extLst',
]

const LEGEND = ['c:legendPos', 'c:legendEntry', 'c:layout', 'c:overlay', 'c:spPr', 'c:txPr']

const TITLE = ['c:tx', 'c:layout', 'c:overlay', 'c:spPr', 'c:txPr', 'c:extLst']

const LABELS = [
  'c:numFmt',
  'c:spPr',
  'c:txPr',
  'c:dLblPos',
  'c:showLegendKey',
  'c:showVal',
  'c:showCatName',
  'c:showSerName',
  'c:showPercent',
  'c:showBubbleSize',
  'c:separator',
  'c:showLeaderLines',
  'c:leaderLines',
]

/** `a:spPr` — a shape's properties, which a series states its colour in. */
const SHAPE_PROPERTIES = [
  'a:xfrm',
  'a:custGeom',
  'a:prstGeom',
  'a:noFill',
  'a:solidFill',
  'a:gradFill',
  'a:blipFill',
  'a:pattFill',
  'a:grpFill',
  'a:ln',
  'a:effectLst',
  'a:effectDag',
  'a:scene3d',
  'a:sp3d',
  'a:extLst',
]

const FILLS = ['a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill', 'a:grpFill']

const SCALING = ['c:logBase', 'c:orientation', 'c:max', 'c:min', 'c:extLst']

const AXIS = [
  'c:axId',
  'c:scaling',
  'c:delete',
  'c:axPos',
  'c:majorGridlines',
  'c:minorGridlines',
  'c:title',
  'c:numFmt',
  'c:majorTickMark',
  'c:minorTickMark',
  'c:tickLblPos',
  'c:spPr',
  'c:txPr',
  'c:crossAx',
  'c:crosses',
  'c:crossesAt',
  'c:crossBetween',
  'c:majorUnit',
  'c:minorUnit',
  'c:dispUnits',
  'c:auto',
  'c:lblAlgn',
  'c:lblOffset',
  'c:tickLblSkip',
  'c:tickMarkSkip',
  'c:noMultiLvlLbl',
  'c:extLst',
]

/** The element a kind is written as, and the children that kind allows. */
const GROUP_TAGS: Readonly<Record<Exclude<ChartKind, 'unsupported'>, string>> = {
  bar: 'c:barChart',
  line: 'c:lineChart',
  area: 'c:areaChart',
  pie: 'c:pieChart',
  doughnut: 'c:doughnutChart',
  scatter: 'c:scatterChart',
  radar: 'c:radarChart',
}

const GROUP_ORDER: Readonly<Record<string, string[]>> = {
  'c:barChart': [
    'c:barDir',
    'c:grouping',
    'c:varyColors',
    'c:ser',
    'c:dLbls',
    'c:gapWidth',
    'c:overlap',
    'c:serLines',
    'c:axId',
  ],
  'c:lineChart': [
    'c:grouping',
    'c:varyColors',
    'c:ser',
    'c:dLbls',
    'c:dropLines',
    'c:hiLowLines',
    'c:upDownBars',
    'c:marker',
    'c:smooth',
    'c:axId',
  ],
  'c:areaChart': ['c:grouping', 'c:varyColors', 'c:ser', 'c:dLbls', 'c:dropLines', 'c:axId'],
  'c:pieChart': ['c:varyColors', 'c:ser', 'c:dLbls', 'c:firstSliceAng'],
  'c:doughnutChart': ['c:varyColors', 'c:ser', 'c:dLbls', 'c:firstSliceAng', 'c:holeSize'],
  'c:scatterChart': ['c:scatterStyle', 'c:varyColors', 'c:ser', 'c:dLbls', 'c:axId'],
  'c:radarChart': ['c:radarStyle', 'c:varyColors', 'c:ser', 'c:dLbls', 'c:axId'],
}

/** A pie and a doughnut hold the same series; only the hole differs. */
const PIE_SERIES = [
  'c:idx',
  'c:order',
  'c:tx',
  'c:spPr',
  'c:explosion',
  'c:dPt',
  'c:dLbls',
  'c:cat',
  'c:val',
  'c:extLst',
]

/** What a series may hold, which is not the same from one kind to the next. */
const SERIES_ORDER: Readonly<Record<string, string[]>> = {
  'c:barChart': [
    'c:idx',
    'c:order',
    'c:tx',
    'c:spPr',
    'c:invertIfNegative',
    'c:pictureOptions',
    'c:dPt',
    'c:dLbls',
    'c:trendline',
    'c:errBars',
    'c:cat',
    'c:val',
    'c:shape',
    'c:extLst',
  ],
  'c:lineChart': [
    'c:idx',
    'c:order',
    'c:tx',
    'c:spPr',
    'c:marker',
    'c:dPt',
    'c:dLbls',
    'c:trendline',
    'c:errBars',
    'c:cat',
    'c:val',
    'c:smooth',
    'c:extLst',
  ],
  'c:areaChart': [
    'c:idx',
    'c:order',
    'c:tx',
    'c:spPr',
    'c:pictureOptions',
    'c:dPt',
    'c:dLbls',
    'c:trendline',
    'c:errBars',
    'c:cat',
    'c:val',
    'c:extLst',
  ],
  'c:pieChart': PIE_SERIES,
  'c:doughnutChart': PIE_SERIES,
  'c:scatterChart': [
    'c:idx',
    'c:order',
    'c:tx',
    'c:spPr',
    'c:marker',
    'c:dPt',
    'c:dLbls',
    'c:trendline',
    'c:errBars',
    'c:xVal',
    'c:yVal',
    'c:smooth',
    'c:extLst',
  ],
  'c:radarChart': [
    'c:idx',
    'c:order',
    'c:tx',
    'c:spPr',
    'c:marker',
    'c:dPt',
    'c:dLbls',
    'c:cat',
    'c:val',
    'c:extLst',
  ],
}

/** The kinds drawn against a pair of axes, which is what decides `c:axId`. */
const NEEDS_AXES = new Set([
  'c:barChart',
  'c:lineChart',
  'c:areaChart',
  'c:scatterChart',
  'c:radarChart',
])

export type ChartEdit =
  | { kind: 'title'; text: string | null }
  /** `b`, `t`, `l`, `r`, `tr`; null takes the legend away. */
  | { kind: 'legend'; position: string | null }
  | { kind: 'seriesColor'; series: number; color: Color | null }
  | { kind: 'labels'; plot: number; show: Partial<LabelFlags> }
  | {
      kind: 'plotType'
      plot: number
      to: Exclude<ChartKind, 'unsupported'>
      grouping?: string
      direction?: string
    }
  | {
      kind: 'plotOptions'
      plot: number
      gapWidth?: number
      overlap?: number
      holeSize?: number
      firstSliceAngle?: number
      varyColors?: boolean
    }
  | {
      kind: 'axis'
      /** `c:axId`, which is how a chart names one of its axes. */
      id: string
      min?: number | null
      max?: number | null
      majorUnit?: number | null
      numberFormat?: string
      title?: string | null
      hidden?: boolean
      reversed?: boolean
    }

export interface LabelFlags {
  values: boolean
  categories: boolean
  percentages: boolean
  seriesName: boolean
}

const LABEL_TAGS: Readonly<Record<keyof LabelFlags, string>> = {
  values: 'c:showVal',
  categories: 'c:showCatName',
  percentages: 'c:showPercent',
  seriesName: 'c:showSerName',
}

/**
 * Applies edits to a chart part, returning the new XML or null when nothing
 * changed.
 *
 * Null rather than the same string back: a caller that writes unconditionally
 * turns a chart nobody edited into a changed part, and a round-trip test that
 * should see an empty diff sees a rewritten file instead.
 */
export function applyChartEdits(xml: string, edits: readonly ChartEdit[]): string | null {
  const roots = parseXml(xml)
  const space = roots.find((node) => tagName(node) === 'c:chartSpace')
  const chart = space === undefined ? undefined : findChild(space, 'c:chart')
  const plotArea = chart === undefined ? undefined : findChild(chart, 'c:plotArea')
  if (chart === undefined || plotArea === undefined) return null

  const changed = edits
    .map((edit) => applyOne(chart, plotArea, edit))
    .reduce<boolean>((any, one) => any || one, false)

  return changed ? withDeclaration(buildXml(roots)) : null
}

function applyOne(chart: XmlNode, plotArea: XmlNode, edit: ChartEdit): boolean {
  switch (edit.kind) {
    case 'title':
      return writeTitle(chart, edit.text)
    case 'legend':
      return writeLegend(chart, edit.position)
    case 'seriesColor':
      return writeSeriesColor(plotArea, edit.series, edit.color)
    case 'labels':
      return writeLabels(groupAt(plotArea, edit.plot), edit.show)
    case 'plotType':
      return writeType(plotArea, edit)
    case 'plotOptions':
      return writeOptions(groupAt(plotArea, edit.plot), edit)
    case 'axis':
      return writeAxis(plotArea, edit)
  }
}

/** Every `c:*Chart` in the plot area, in the order it lists them. */
const groupsOf = (plotArea: XmlNode): XmlNode[] =>
  children(plotArea).filter((child) => (tagName(child) ?? '').endsWith('Chart'))

const groupAt = (plotArea: XmlNode, index: number): XmlNode | undefined => groupsOf(plotArea)[index]

/** Every `c:ser` of the plot area, counted straight through as a reader sees them. */
const seriesOf = (plotArea: XmlNode): XmlNode[] =>
  groupsOf(plotArea).flatMap((group) =>
    children(group).filter((child) => tagName(child) === 'c:ser'),
  )

const flag = (tag: string, on: boolean): XmlNode => element(tag, { val: on ? '1' : '0' })
const valued = (tag: string, value: number | string): XmlNode =>
  element(tag, { val: String(value) })

/** A run of text, as a title is written. */
const textRun = (text: string): XmlNode =>
  element('a:r', {}, [element('a:t', {}, [{ '#text': text }])])

/**
 * Writes the words of a title, keeping the formatting they were written in.
 *
 * A title is a text body, so its words are spread across runs that each carry
 * their own `a:rPr`. Replacing the body would throw away the font somebody
 * chose; the first run is kept and given the new words, and the rest go.
 */
function writeTitleText(rich: XmlNode, text: string): void {
  const paragraphs = children(rich).filter((child) => tagName(child) === 'a:p')
  const first = paragraphs[0]
  if (first === undefined) {
    children(rich).push(element('a:p', {}, [textRun(text)]))
    return
  }

  // Everything after the first paragraph is a second line of a title that is
  // about to be one line.
  const body = children(rich)
  const extra = paragraphs.slice(1)
  for (const paragraph of extra) body.splice(body.indexOf(paragraph), 1)

  const runs = children(first).filter((child) => tagName(child) === 'a:r')
  const kept = runs[0]
  if (kept === undefined) {
    children(first).push(textRun(text))
    return
  }

  for (const run of runs.slice(1)) {
    const at = children(first).indexOf(run)
    if (at !== -1) children(first).splice(at, 1)
  }

  const label = findChild(kept, 'a:t')
  if (label === undefined) {
    children(kept).push(element('a:t', {}, [{ '#text': text }]))
    return
  }

  const nodes = children(label)
  nodes.length = 0
  nodes.push({ '#text': text })
}

function writeTitle(chart: XmlNode, text: string | null): boolean {
  if (text === null) {
    if (findChild(chart, 'c:title') === undefined) return false

    // Removing the element is not enough: without this Office writes the
    // automatic title back the moment the chart has one series.
    removeChild(chart, 'c:title')
    upsertChild(chart, flag('c:autoTitleDeleted', true), CHART)
    return true
  }

  const existing = findChild(chart, 'c:title')
  const title = existing ?? element('c:title', {}, [element('c:overlay', { val: '0' })])
  const tx = findChild(title, 'c:tx') ?? element('c:tx')
  const rich = findChild(tx, 'c:rich') ?? element('c:rich', {}, [element('a:bodyPr')])

  writeTitleText(rich, text)

  // A title bound to a cell is replaced by one that says what it says: the two
  // are alternatives, and leaving the reference would have Office overwrite
  // these words from the sheet.
  removeChild(tx, 'c:strRef')
  upsertChild(tx, rich, ['c:strRef', 'c:rich'])
  upsertChild(title, tx, TITLE)
  upsertChild(chart, title, CHART)

  // Only where the chart says the title was deleted. Writing it otherwise
  // would add an element to a file that was getting a title, not a statement
  // about titles it used to have.
  if (attribute(findChild(chart, 'c:autoTitleDeleted') ?? {}, 'val') === '1') {
    upsertChild(chart, flag('c:autoTitleDeleted', false), CHART)
  }
  return true
}

function writeLegend(chart: XmlNode, position: string | null): boolean {
  if (position === null) {
    if (findChild(chart, 'c:legend') === undefined) return false
    removeChild(chart, 'c:legend')
    return true
  }

  const existing = findChild(chart, 'c:legend')
  if (existing !== undefined) {
    // Only the position. `c:overlay` is not modelled and was not asked about,
    // and adding it would be this writer having an opinion about a file it was
    // told to change in one respect.
    upsertChild(existing, valued('c:legendPos', position), LEGEND)
    return true
  }

  // A legend being made from nothing has to say where it sits and whether it
  // sits over the plot, because there is no previous answer to keep.
  upsertChild(
    chart,
    element('c:legend', {}, [valued('c:legendPos', position), element('c:overlay', { val: '0' })]),
    CHART,
  )
  return true
}

/** A colour as the element that states it, with its modifiers kept in order. */
function colorElement(color: Color): XmlNode {
  const transforms = color.transforms.map((transform) =>
    element(`a:${transform.kind}`, { val: String(Math.round(transform.value * 100000)) }),
  )

  switch (color.source.kind) {
    case 'srgb':
      return element('a:srgbClr', { val: color.source.hex.replace('#', '') }, transforms)
    case 'scheme':
      return element('a:schemeClr', { val: color.source.name }, transforms)
    case 'system':
      return element('a:sysClr', { val: color.source.name }, transforms)
    case 'preset':
      return element('a:prstClr', { val: color.source.name }, transforms)
  }
}

function writeSeriesColor(plotArea: XmlNode, index: number, color: Color | null): boolean {
  const series = seriesOf(plotArea)[index]
  if (series === undefined) return false

  const order = SERIES_ORDER[tagName(parentGroupOf(plotArea, series) ?? {}) ?? ''] ?? []
  const properties = findChild(series, 'c:spPr') ?? element('c:spPr')

  // One fill at a time: a solid fill beside the gradient it replaces is a file
  // Excel reads as neither.
  for (const fill of FILLS) removeChild(properties, fill)

  if (color !== null) {
    upsertChild(properties, element('a:solidFill', {}, [colorElement(color)]), SHAPE_PROPERTIES)
  }

  upsertChild(series, properties, order)
  return true
}

/** The group a series belongs to, for the schema order its children follow. */
function parentGroupOf(plotArea: XmlNode, series: XmlNode): XmlNode | undefined {
  return groupsOf(plotArea).find((group) => children(group).includes(series))
}

function writeLabels(group: XmlNode | undefined, show: Partial<LabelFlags>): boolean {
  if (group === undefined) return false

  const labels = findChild(group, 'c:dLbls') ?? element('c:dLbls')
  const asked = Object.entries(show) as [keyof LabelFlags, boolean | undefined][]
  if (asked.length === 0) return false

  for (const [name, on] of asked) {
    if (on === undefined) continue
    upsertChild(labels, flag(LABEL_TAGS[name], on), LABELS)
  }

  // The flags Office always writes, so a chart that shows nothing says so
  // rather than leaving the reader to guess at defaults.
  for (const tag of [
    'c:showLegendKey',
    'c:showVal',
    'c:showCatName',
    'c:showSerName',
    'c:showPercent',
    'c:showBubbleSize',
  ]) {
    if (findChild(labels, tag) === undefined) upsertChild(labels, flag(tag, false), LABELS)
  }

  upsertChild(group, labels, GROUP_ORDER[tagName(group) ?? ''] ?? [])
  return true
}

function writeOptions(
  group: XmlNode | undefined,
  edit: Extract<ChartEdit, { kind: 'plotOptions' }>,
): boolean {
  if (group === undefined) return false

  const order = GROUP_ORDER[tagName(group) ?? ''] ?? []
  const wanted: [string, number | boolean | undefined][] = [
    ['c:gapWidth', edit.gapWidth],
    ['c:overlap', edit.overlap],
    ['c:holeSize', edit.holeSize],
    ['c:firstSliceAng', edit.firstSliceAngle],
    ['c:varyColors', edit.varyColors],
  ]

  const written = wanted.filter(([tag, value]) => {
    if (value === undefined || !order.includes(tag)) return false

    upsertChild(group, typeof value === 'boolean' ? flag(tag, value) : valued(tag, value), order)
    return true
  })

  return written.length > 0
}

function writeAxis(plotArea: XmlNode, edit: Extract<ChartEdit, { kind: 'axis' }>): boolean {
  const axis = children(plotArea).find((child) => {
    const tag = tagName(child) ?? ''
    if (!['c:catAx', 'c:valAx', 'c:dateAx', 'c:serAx'].includes(tag)) return false
    return (
      (findChild(child, 'c:axId')?.[':@'] as Record<string, string> | undefined)?.['@_val'] ===
      edit.id
    )
  })
  if (axis === undefined) return false

  const scaling = findChild(axis, 'c:scaling') ?? element('c:scaling')
  const scale: [string, number | null | undefined][] = [
    ['c:min', edit.min],
    ['c:max', edit.max],
  ]

  const touched: boolean[] = []

  for (const [tag, value] of scale) {
    if (value === undefined) continue
    if (value === null) removeChild(scaling, tag)
    else upsertChild(scaling, valued(tag, value), SCALING)
    touched.push(true)
  }

  if (edit.reversed !== undefined) {
    upsertChild(scaling, valued('c:orientation', edit.reversed ? 'maxMin' : 'minMax'), SCALING)
    touched.push(true)
  }

  if (touched.length > 0) upsertChild(axis, scaling, AXIS)

  if (edit.majorUnit !== undefined) {
    if (edit.majorUnit === null) removeChild(axis, 'c:majorUnit')
    else upsertChild(axis, valued('c:majorUnit', edit.majorUnit), AXIS)
    touched.push(true)
  }

  if (edit.numberFormat !== undefined) {
    // `sourceLinked` off, or Excel takes the format from the cells again and
    // the one just chosen disappears on the next open.
    upsertChild(
      axis,
      element('c:numFmt', { formatCode: edit.numberFormat, sourceLinked: '0' }),
      AXIS,
    )
    touched.push(true)
  }

  if (edit.hidden !== undefined) {
    upsertChild(axis, flag('c:delete', edit.hidden), AXIS)
    touched.push(true)
  }

  if (edit.title !== undefined) {
    if (edit.title === null) {
      removeChild(axis, 'c:title')
    } else {
      const title = findChild(axis, 'c:title') ?? element('c:title')
      const tx = findChild(title, 'c:tx') ?? element('c:tx')
      const rich = findChild(tx, 'c:rich') ?? element('c:rich', {}, [element('a:bodyPr')])

      writeTitleText(rich, edit.title)
      upsertChild(tx, rich, ['c:strRef', 'c:rich'])
      upsertChild(title, tx, TITLE)
      upsertChild(axis, title, AXIS)
    }
    touched.push(true)
  }

  return touched.length > 0
}

/** A fresh pair of axes, for a chart that had none because it was a pie. */
function addAxes(plotArea: XmlNode): [string, string] {
  const used = children(plotArea).flatMap((child) => {
    const id = findChild(child, 'c:axId')
    const value = (id?.[':@'] as Record<string, string> | undefined)?.['@_val']
    return value === undefined ? [] : [Number(value)]
  })

  const first = String(Math.max(0, ...used) + 1)
  const second = String(Math.max(0, ...used) + 2)

  const axis = (tag: string, id: string, other: string, position: string) =>
    element(tag, {}, [
      valued('c:axId', id),
      element('c:scaling', {}, [valued('c:orientation', 'minMax')]),
      flag('c:delete', false),
      valued('c:axPos', position),
      valued('c:crossAx', other),
    ])

  children(plotArea).push(axis('c:catAx', first, second, 'b'))
  children(plotArea).push(axis('c:valAx', second, first, 'l'))
  return [first, second]
}

/** Renames an element, keeping its attributes and the children handed over. */
function renamed(node: XmlNode, tag: string, kept: XmlNode[]): XmlNode {
  const attributes = node[':@']
  return attributes === undefined ? { [tag]: kept } : { [tag]: kept, ':@': attributes }
}

/**
 * Turns one kind of chart into another.
 *
 * The group is renamed and the children that do not belong to the new kind are
 * dropped — a line chart with a `c:gapWidth` in it is a file Excel repairs.
 * The series come across, with their own children filtered the same way, and a
 * scatter's `c:xVal`/`c:yVal` renamed to the `c:cat`/`c:val` everything else
 * uses, because that is the same data under another name.
 */
function writeType(plotArea: XmlNode, edit: Extract<ChartEdit, { kind: 'plotType' }>): boolean {
  const group = groupAt(plotArea, edit.plot)
  if (group === undefined) return false

  const from = tagName(group) ?? ''
  const to = GROUP_TAGS[edit.to]
  const order = GROUP_ORDER[to] ?? []
  const seriesOrder = SERIES_ORDER[to] ?? []

  // Becoming a scatter, or ceasing to be one. Asked as a change rather than as
  // two independent facts: a scatter turned into a scatter is both at once, and
  // renaming its `c:xVal` to `c:cat` and then dropping `c:cat` as a child a
  // scatter may not have takes the chart's numbers with it.
  const becomingScatter = to === 'c:scatterChart' && from !== 'c:scatterChart'
  const leavingScatter = from === 'c:scatterChart' && to !== 'c:scatterChart'

  const series = children(group)
    .filter((child) => tagName(child) === 'c:ser')
    .map((one) => {
      const kept = children(one)
        .map((child) => {
          const tag = tagName(child) ?? ''
          if (becomingScatter && tag === 'c:cat') return renamed(child, 'c:xVal', children(child))
          if (becomingScatter && tag === 'c:val') return renamed(child, 'c:yVal', children(child))
          if (leavingScatter && tag === 'c:xVal') return renamed(child, 'c:cat', children(child))
          if (leavingScatter && tag === 'c:yVal') return renamed(child, 'c:val', children(child))
          return child
        })
        .filter((child) => seriesOrder.includes(tagName(child) ?? ''))
        .sort(
          (a, b) => seriesOrder.indexOf(tagName(a) ?? '') - seriesOrder.indexOf(tagName(b) ?? ''),
        )

      return renamed(one, 'c:ser', kept)
    })

  const axisIds = children(group)
    .filter((child) => tagName(child) === 'c:axId')
    .map((child) => child)

  const carried = children(group).filter((child) => {
    const tag = tagName(child) ?? ''
    return tag !== 'c:ser' && tag !== 'c:axId' && order.includes(tag)
  })

  const needsAxes = NEEDS_AXES.has(to)
  const axes = needsAxes
    ? axisIds.length > 0
      ? axisIds
      : addAxes(plotArea).map((id) => valued('c:axId', id))
    : []

  const made = [...carried, ...series, ...axes].sort(
    (a, b) => order.indexOf(tagName(a) ?? '') - order.indexOf(tagName(b) ?? ''),
  )

  /** What the group already said about itself, where the new kind still allows it. */
  const held = (tag: string): string | null =>
    attribute(carried.find((child) => tagName(child) === tag) ?? {}, 'val') ?? null

  /**
   * The things a kind must say about itself.
   *
   * What the edit asks for, then what the chart already said, and only then a
   * default. Asked in that order because the panel sends one property at a
   * time: a request to stack a horizontal bar chart says nothing about its
   * direction, and a default written over the silence would stand it upright.
   */
  const stated: XmlNode[] = []
  if (to === 'c:barChart') {
    stated.push(valued('c:barDir', edit.direction ?? held('c:barDir') ?? 'col'))
    stated.push(valued('c:grouping', edit.grouping ?? held('c:grouping') ?? 'clustered'))
  }
  if (to === 'c:lineChart' || to === 'c:areaChart') {
    // `clustered` is a bar's word and travels here on a chart that used to be
    // one, because `c:grouping` is spelled the same in both. Left alone it
    // would be a value the schema has no name for.
    const previous = held('c:grouping')
    stated.push(
      valued(
        'c:grouping',
        edit.grouping ?? (previous === 'clustered' ? null : previous) ?? 'standard',
      ),
    )
  }
  if (to === 'c:scatterChart') {
    stated.push(valued('c:scatterStyle', held('c:scatterStyle') ?? 'lineMarker'))
  }
  if (to === 'c:radarChart') {
    stated.push(valued('c:radarStyle', edit.grouping ?? held('c:radarStyle') ?? 'marker'))
  }

  const replacement = renamed(group, to, made)
  for (const child of stated) upsertChild(replacement, child, order)

  const at = children(plotArea).indexOf(group)
  if (at === -1) return false

  // Turning a chart into the kind it already is, with the properties it
  // already has, is not an edit. Reported as one it would mark the file dirty
  // and add a step to the undo history for choosing what was already chosen.
  if (buildXml([group]) === buildXml([replacement])) return false

  children(plotArea)[at] = replacement

  // A pie has no axes; leaving the old pair behind would have Excel draw a
  // chart against scales nothing is measured on.
  if (!needsAxes) removeOrphanAxes(plotArea)
  return true
}

/** Axes no group names any more, which is what a pie leaves behind. */
function removeOrphanAxes(plotArea: XmlNode): void {
  const named = new Set(
    groupsOf(plotArea).flatMap((group) =>
      children(group)
        .filter((child) => tagName(child) === 'c:axId')
        .map((child) => (child[':@'] as Record<string, string> | undefined)?.['@_val'] ?? ''),
    ),
  )

  const siblings = children(plotArea)
  const orphans = siblings.filter((child) => {
    const tag = tagName(child) ?? ''
    if (!['c:catAx', 'c:valAx', 'c:dateAx', 'c:serAx'].includes(tag)) return false

    const id = (findChild(child, 'c:axId')?.[':@'] as Record<string, string> | undefined)?.['@_val']
    return id === undefined || !named.has(id)
  })

  for (const orphan of orphans) {
    const at = siblings.indexOf(orphan)
    if (at !== -1) siblings.splice(at, 1)
  }
}
