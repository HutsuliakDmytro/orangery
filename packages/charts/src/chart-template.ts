import { newWorkbook } from '@orangery/ooxml-spreadsheet'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import type { ChartKind } from './chart'

/**
 * A chart made from nothing.
 *
 * Unlike every other write in this package, there is no original to patch: the
 * part is being created, so it is written out as the text it is. What it must
 * be is schema-ordered and complete enough that Office opens it without
 * offering to repair, which is what the tests here are about.
 *
 * The numbers are the ones PowerPoint puts in a new chart. That is not
 * nostalgia: a new chart has to show something, and the shape of the default
 * table — a header row, a column of names, columns of numbers — is what the
 * data editor and the ranges in `c:f` are built around.
 */

export type NewChartKind = 'bar' | 'line' | 'area' | 'pie' | 'scatter'

export interface ChartData {
  /** The names along the bottom; numbers for a scatter, which measures them. */
  categories: readonly (string | number)[]
  series: readonly { name: string; values: readonly number[] }[]
}

const COLUMNS: ChartData = {
  categories: ['Category 1', 'Category 2', 'Category 3', 'Category 4'],
  series: [
    { name: 'Series 1', values: [4.3, 2.5, 3.5, 4.5] },
    { name: 'Series 2', values: [2.4, 4.4, 1.8, 2.8] },
    { name: 'Series 3', values: [2, 2, 3, 5] },
  ],
}

/** A pie draws one series; a second one would be a ring it cannot show. */
const SLICES: ChartData = {
  categories: ['1st Qtr', '2nd Qtr', '3rd Qtr', '4th Qtr'],
  series: [{ name: 'Sales', values: [8.2, 3.2, 1.4, 1.2] }],
}

const POINTS: ChartData = {
  categories: [0.7, 1.8, 2.6],
  series: [{ name: 'Series 1', values: [1.8, 2.8, 3.5] }],
}

export function defaultChartData(kind: NewChartKind): ChartData {
  if (kind === 'pie') return SLICES
  return kind === 'scatter' ? POINTS : COLUMNS
}

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NAMESPACES =
  'xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ' +
  'xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

/** The ids a new chart gives its axes; anything unique will do. */
const CATEGORY_AXIS = '111111111'
const VALUE_AXIS = '222222222'

const escaped = (text: string): string =>
  text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')

const column = (index: number): string => String.fromCharCode(66 + index)

const cache = (tag: 'str' | 'num', values: readonly (string | number)[]): string =>
  `<c:${tag}Cache>${tag === 'num' ? '<c:formatCode>General</c:formatCode>' : ''}` +
  `<c:ptCount val="${String(values.length)}"/>` +
  values
    .map(
      (value, index) => `<c:pt idx="${String(index)}"><c:v>${escaped(String(value))}</c:v></c:pt>`,
    )
    .join('') +
  `</c:${tag}Cache>`

/** A reference and the cache beside it, which is the pair every series is made of. */
const reference = (
  element: string,
  kind: 'str' | 'num',
  formula: string,
  values: readonly (string | number)[],
): string =>
  `<c:${element}><c:${kind}Ref><c:f>${formula}</c:f>${cache(kind, values)}</c:${kind}Ref></c:${element}>`

function seriesXml(data: ChartData, index: number, kind: NewChartKind): string {
  const one = data.series[index]
  if (one === undefined) return ''

  const at = String(index)
  const letter = column(index)
  const rows = data.categories.length + 1

  const name = reference('tx', 'str', `Sheet1!$${letter}$1`, [one.name])
  const values = reference(
    kind === 'scatter' ? 'yVal' : 'val',
    'num',
    `Sheet1!$${letter}$2:$${letter}$${String(rows)}`,
    one.values,
  )

  // A scatter measures its bottom, so its categories are numbers in an x
  // reference rather than names in a category one.
  const categories = reference(
    kind === 'scatter' ? 'xVal' : 'cat',
    kind === 'scatter' ? 'num' : 'str',
    `Sheet1!$A$2:$A$${String(rows)}`,
    data.categories,
  )

  const marker =
    kind === 'line' || kind === 'scatter'
      ? '<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>'
      : ''
  const smooth = kind === 'line' || kind === 'scatter' ? '<c:smooth val="0"/>' : ''

  return `<c:ser><c:idx val="${at}"/><c:order val="${at}"/>${name}${marker}${categories}${values}${smooth}</c:ser>`
}

const AXES =
  `<c:catAx><c:axId val="${CATEGORY_AXIS}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
  `<c:delete val="0"/><c:axPos val="b"/><c:crossAx val="${VALUE_AXIS}"/></c:catAx>` +
  `<c:valAx><c:axId val="${VALUE_AXIS}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
  `<c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="${CATEGORY_AXIS}"/></c:valAx>`

/** The axes a scatter has: both of them measure, so both are value axes. */
const SCATTER_AXES =
  `<c:valAx><c:axId val="${CATEGORY_AXIS}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
  `<c:delete val="0"/><c:axPos val="b"/><c:crossAx val="${VALUE_AXIS}"/></c:valAx>` +
  `<c:valAx><c:axId val="${VALUE_AXIS}"/><c:scaling><c:orientation val="minMax"/></c:scaling>` +
  `<c:delete val="0"/><c:axPos val="l"/><c:majorGridlines/><c:crossAx val="${CATEGORY_AXIS}"/></c:valAx>`

function groupXml(kind: NewChartKind, data: ChartData): string {
  const series = data.series.map((_, index) => seriesXml(data, index, kind)).join('')
  const axes = `<c:axId val="${CATEGORY_AXIS}"/><c:axId val="${VALUE_AXIS}"/>`

  switch (kind) {
    case 'bar':
      // Gap 150 and overlap -27 are what Office writes; a chart that stated
      // neither would be drawn to a reader's defaults rather than to these.
      return (
        '<c:barChart><c:barDir val="col"/><c:grouping val="clustered"/><c:varyColors val="0"/>' +
        `${series}<c:gapWidth val="150"/><c:overlap val="-27"/>${axes}</c:barChart>`
      )
    case 'line':
      return (
        '<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>' +
        `${series}<c:marker val="1"/>${axes}</c:lineChart>`
      )
    case 'area':
      return `<c:areaChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}${axes}</c:areaChart>`
    case 'scatter':
      return `<c:scatterChart><c:scatterStyle val="lineMarker"/><c:varyColors val="0"/>${series}${axes}</c:scatterChart>`
    case 'pie':
      // A pie colours its points rather than its series, and says so.
      return `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`
  }
}

/**
 * The chart part for a new chart, pointing at the workbook beside it.
 *
 * `c:externalData` names that workbook by relationship, which is what "Edit
 * Data" follows. A chart written without it opens, draws from its cache, and
 * offers no way back to the numbers.
 */
export function newChartPart(kind: NewChartKind, data: ChartData = defaultChartData(kind)): string {
  const round = kind === 'pie'
  const axes = round ? '' : kind === 'scatter' ? SCATTER_AXES : AXES

  return (
    `${DECLARATION}<c:chartSpace ${NAMESPACES}><c:date1904 val="0"/><c:roundedCorners val="0"/>` +
    '<c:chart><c:plotArea><c:layout/>' +
    `${groupXml(kind, data)}${axes}</c:plotArea>` +
    '<c:legend><c:legendPos val="b"/><c:overlay val="0"/></c:legend>' +
    '<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart>' +
    '<c:externalData r:id="rId1"><c:autoUpdate val="0"/></c:externalData></c:chartSpace>'
  )
}

/**
 * The workbook a new chart embeds: the same table, as cells.
 *
 * Laid out the way the references in the part expect — names down column A,
 * one column of numbers per series, headers in row 1 — because the two are one
 * thing described twice, and a mismatch is a chart whose editor shows the
 * wrong cells.
 */
export function newChartWorkbook(data: ChartData): OoxmlPackage {
  const header: (string | number | null)[] = [null, ...data.series.map((one) => one.name)]
  const rows = data.categories.map((category, row) => [
    category,
    ...data.series.map((one) => one.values[row] ?? null),
  ])

  return newWorkbook([{ name: 'Sheet1', rows: [header, ...rows] }])
}

/** What a new chart of this kind is called, for the frame it goes into. */
export const chartTitleFor = (kind: NewChartKind): string =>
  ({
    bar: 'Column chart',
    line: 'Line chart',
    area: 'Area chart',
    pie: 'Pie chart',
    scatter: 'Scatter chart',
  })[kind]

/** The model kind a new chart of this kind reads back as. */
export const kindOfNew = (kind: NewChartKind): ChartKind => kind
