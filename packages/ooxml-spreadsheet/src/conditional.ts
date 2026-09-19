import { attribute, children, findChild, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { columnToIndex, parseRange } from './reference'
import type { CellRange } from './reference'
import type { StyleColor } from './styles'
import { textOf } from './workbook'

/**
 * Conditional formatting, as the file states it.
 *
 * A rule is a condition and a look: cells over a hundred in red, a green bar
 * across each one in proportion to its value, an arrow beside it. What makes
 * this different from a cell's own style is that it is not in the cell — the
 * sheet carries a list of ranges and rules, and what any one cell looks like
 * is the answer to a question asked about every rule that covers it.
 *
 * Read here, judged in `highlight.ts`. The split is the same one the rest of
 * this package makes: what the file says is one thing, and what it means for a
 * cell on screen is another, and the second needs the values of every cell in
 * the range while the first needs none of them.
 */

/**
 * One end of a scale — the `cfvo` a bar, a colour scale or an icon set measures
 * against.
 *
 * `min` and `max` mean the smallest and largest value in the range, so two
 * rules with the same numbers can mean different colours on different data.
 * `percent` is a fraction of the way between them; `percentile` is a place in
 * the sorted values, which is not the same thing and is the one that survives
 * an outlier.
 */
export interface ConditionalValue {
  type: 'min' | 'max' | 'num' | 'percent' | 'percentile' | 'formula'
  /** As written, because a formula is not a number until something evaluates it. */
  value: string | null
  /** Whether a value exactly on the threshold belongs to the band above it. */
  inclusive: boolean
}

export interface ColorScale {
  /** Two stops for a two-colour scale, three for a three-colour one. */
  values: ConditionalValue[]
  colors: StyleColor[]
}

export interface DataBar {
  lower: ConditionalValue
  upper: ConditionalValue
  color: StyleColor | null
  /** A bar with the number hidden is a chart in a column of cells. */
  showValue: boolean
  /**
   * The shortest and longest bar, as a percentage of the cell.
   *
   * The floor is why the smallest value still shows something: a bar of no
   * width says "no rule here" rather than "the least of these".
   */
  minLength: number
  maxLength: number
}

export interface IconSet {
  /** `3TrafficLights1`, `5Arrows`, and the two dozen others Excel offers. */
  name: string
  /** One per icon; the first is the floor and is always passed. */
  values: ConditionalValue[]
  showValue: boolean
  /** Flips which end of the scale gets which icon. */
  reverse: boolean
}

/**
 * A rule, with the parts that belong to its kind filled in.
 *
 * One interface rather than a union per type: a rule is one element in the
 * file with a `type` attribute and a scatter of optional attributes, and a
 * reader that modelled twelve shapes would spend its code deciding which one
 * it had rather than reading what is there.
 */
export interface ConditionalRule {
  /**
   * `cellIs`, `containsText`, `colorScale`, `dataBar`, `iconSet`, `top10`,
   * `aboveAverage`, `duplicateValues`, `expression`… — the file's own word.
   */
  type: string
  /** Lower wins. Rules are applied in this order and the first to say so decides. */
  priority: number
  /** Whether the rules below this one are left unasked once this one matches. */
  stopIfTrue: boolean
  /** Into `dxfs`: the look this rule puts on a cell that matches it. */
  dxfId: number | null
  /** `greaterThan`, `between`, `beginsWith`… for the kinds that compare. */
  operator: string | null
  /** What the text rules look for, stated plainly beside the formula that repeats it. */
  text: string | null
  /** In the file's own A1 form; one for most operators and two for `between`. */
  formulas: string[]
  /** `top10`: how many, and from which end. */
  rank: number | null
  /** Whether `rank` counts cells or percent of them. */
  percent: boolean
  bottom: boolean
  /** `aboveAverage`: which side of the mean, and whether the mean itself counts. */
  above: boolean
  equalAverage: boolean
  /** How many standard deviations out, when the rule asks for that instead. */
  standardDeviation: number | null
  /** `timePeriod`: `today`, `last7Days`, `thisMonth`… */
  timePeriod: string | null
  colorScale: ColorScale | null
  dataBar: DataBar | null
  iconSet: IconSet | null
}

export interface ConditionalFormat {
  /** `sqref` is a list: one block of rules can cover ranges that do not touch. */
  ranges: CellRange[]
  rules: ConditionalRule[]
}

const number = (
  node: XmlNode | undefined,
  name: string,
  fallback: number | null,
): number | null => {
  const value = Number(attribute(node ?? {}, name))
  return attribute(node ?? {}, name) === undefined || !Number.isFinite(value) ? fallback : value
}

/**
 * A boolean attribute, with the default the format states for it.
 *
 * The defaults are not all false and getting one wrong is invisible: an icon
 * set whose `showValue` defaulted to false would quietly hide every number in
 * the range.
 */
const flag = (node: XmlNode | undefined, name: string, fallback: boolean): boolean => {
  const value = attribute(node ?? {}, name)
  if (value === undefined) return fallback
  return value === '1' || value === 'true'
}

function readColor(node: XmlNode | undefined): StyleColor | null {
  if (node === undefined) return null

  const rgb = attribute(node, 'rgb')
  if (rgb !== undefined) return { kind: 'rgb', hex: rgb }

  const theme = number(node, 'theme', null)
  if (theme !== null) return { kind: 'theme', index: theme, tint: number(node, 'tint', 0) ?? 0 }

  const indexed = number(node, 'indexed', null)
  if (indexed !== null) return { kind: 'indexed', index: indexed }

  return flag(node, 'auto', false) ? { kind: 'auto' } : null
}

const VALUE_KINDS = new Set(['min', 'max', 'num', 'percent', 'percentile', 'formula'])

function readValue(node: XmlNode): ConditionalValue {
  const kind = attribute(node, 'type') ?? 'num'

  return {
    type: (VALUE_KINDS.has(kind) ? kind : 'num') as ConditionalValue['type'],
    // `val` is the attribute in nearly every file; older writers put the
    // number in the element instead, which is the same number said differently.
    value: attribute(node, 'val') ?? (textOf(node) === '' ? null : textOf(node)),
    inclusive: flag(node, 'gte', true),
  }
}

const valuesOf = (node: XmlNode): ConditionalValue[] =>
  children(node)
    .filter((child) => tagName(child) === 'cfvo')
    .map(readValue)

const colorsOf = (node: XmlNode): StyleColor[] =>
  children(node)
    .filter((child) => tagName(child) === 'color')
    .flatMap((child) => {
      const color = readColor(child)
      return color === null ? [] : [color]
    })

function readColorScale(node: XmlNode | undefined): ColorScale | null {
  if (node === undefined) return null
  return { values: valuesOf(node), colors: colorsOf(node) }
}

function readDataBar(node: XmlNode | undefined): DataBar | null {
  if (node === undefined) return null

  const [lower, upper] = valuesOf(node)
  if (lower === undefined || upper === undefined) return null

  return {
    lower,
    upper,
    color: readColor(findChild(node, 'color')),
    showValue: flag(node, 'showValue', true),
    minLength: number(node, 'minLength', 10) ?? 10,
    maxLength: number(node, 'maxLength', 90) ?? 90,
  }
}

function readIconSet(node: XmlNode | undefined): IconSet | null {
  if (node === undefined) return null

  return {
    name: attribute(node, 'iconSet') ?? '3TrafficLights1',
    values: valuesOf(node),
    showValue: flag(node, 'showValue', true),
    reverse: flag(node, 'reverse', false),
  }
}

function readRule(node: XmlNode): ConditionalRule {
  return {
    type: attribute(node, 'type') ?? '',
    // A rule with no priority is a rule nothing can order; last is where a
    // reader that keeps it can put it without displacing one that said.
    priority: number(node, 'priority', Number.MAX_SAFE_INTEGER) ?? Number.MAX_SAFE_INTEGER,
    stopIfTrue: flag(node, 'stopIfTrue', false),
    dxfId: number(node, 'dxfId', null),
    operator: attribute(node, 'operator') ?? null,
    text: attribute(node, 'text') ?? null,
    formulas: children(node)
      .filter((child) => tagName(child) === 'formula')
      .map((child) => textOf(child)),
    rank: number(node, 'rank', null),
    percent: flag(node, 'percent', false),
    bottom: flag(node, 'bottom', false),
    above: flag(node, 'aboveAverage', true),
    equalAverage: flag(node, 'equalAverage', false),
    standardDeviation: number(node, 'stdDev', null),
    timePeriod: attribute(node, 'timePeriod') ?? null,
    colorScale: readColorScale(findChild(node, 'colorScale')),
    dataBar: readDataBar(findChild(node, 'dataBar')),
    iconSet: readIconSet(findChild(node, 'iconSet')),
  }
}

/**
 * The blocks of conditional formatting on a worksheet.
 *
 * Kept as blocks rather than flattened into one list of rules: the ranges
 * belong to the block, and a rule lifted out of it would no longer know which
 * cells it was about.
 */
export function readConditionalFormats(root: XmlNode): ConditionalFormat[] {
  return children(root)
    .filter((child) => tagName(child) === 'conditionalFormatting')
    .map((block) => ({
      ranges: (attribute(block, 'sqref') ?? '').split(/\s+/u).flatMap(referenceRange),
      rules: children(block)
        .filter((child) => tagName(child) === 'cfRule')
        .map(readRule)
        .sort((a, b) => a.priority - b.priority),
    }))
    .filter((block) => block.ranges.length > 0 && block.rules.length > 0)
}

/** The last row and column a sheet has, which is what `A:A` means. */
const LAST_ROW = 1_048_576
const LAST_COLUMN = 16_384

/**
 * One reference of an `sqref`, including the ones that name no cell.
 *
 * `A:A` is a whole column and `2:4` is three whole rows, and both are written
 * by Excel when a rule is applied to a column header rather than a selection.
 * Spelled out to the sheet's own extent here so that everything downstream has
 * a range with four numbers in it.
 */
function referenceRange(reference: string): CellRange[] {
  const range = parseRange(reference)
  if (range !== null) return [range]

  const columns = /^\$?([A-Z]+):\$?([A-Z]+)$/u.exec(reference.trim().toUpperCase())
  if (columns !== null) {
    const from = columnToIndex(columns[1] ?? '')
    const to = columnToIndex(columns[2] ?? '')
    if (from === null || to === null) return []
    return [{ sheet: null, from: { row: 0, column: from }, to: { row: LAST_ROW - 1, column: to } }]
  }

  const rows = /^\$?(\d+):\$?(\d+)$/u.exec(reference.trim())
  if (rows === null) return []

  const from = Number(rows[1])
  const to = Number(rows[2])
  if (!Number.isFinite(from) || !Number.isFinite(to)) return []

  return [
    {
      sheet: null,
      from: { row: from - 1, column: 0 },
      to: { row: to - 1, column: LAST_COLUMN - 1 },
    },
  ]
}

/** Whether a range covers a cell. */
export const rangeCovers = (range: CellRange, cell: { row: number; column: number }): boolean =>
  cell.row >= Math.min(range.from.row, range.to.row) &&
  cell.row <= Math.max(range.from.row, range.to.row) &&
  cell.column >= Math.min(range.from.column, range.to.column) &&
  cell.column <= Math.max(range.from.column, range.to.column)
