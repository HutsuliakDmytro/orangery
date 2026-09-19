import { rangeCovers } from './conditional'
import type { ConditionalFormat, ConditionalRule, ConditionalValue } from './conditional'
import { resolveColor } from './colors'
import type { ColorPalette } from './colors'
import type { CellPosition, CellRange } from './reference'

/**
 * What conditional formatting makes of a cell.
 *
 * The rules are read elsewhere; this is where they are asked about a value.
 * Asked one cell at a time, because a sheet has a million of them and a window
 * shows two hundred — but a rule is about the range, not the cell, so the
 * statistics a colour scale or a top-ten rule needs are worked out once for
 * the whole block and kept (`apps/sheets/PLAN.md`, phase 1.3).
 *
 * What is not judged here is anything that needs a formula: an `expression`
 * rule, a `cellIs` whose operand is a reference, a `cfvo` of type `formula`.
 * They are recognised and left alone rather than guessed at — a rule that
 * highlighted the wrong cells would be worse than one that highlighted none —
 * and they light up when the engine arrives (`PLAN.md`, phase 3).
 */

/** A cell as a rule sees it: a number, words, or an error, and blank is none. */
export interface HighlightValue {
  /** The number in the cell, or null where it holds something else. */
  number: number | null
  /** The cell as words — what a text rule searches, and what an error says. */
  text: string | null
  error: boolean
}

/** A bar across a cell, in proportion to the value in it. */
export interface CellBar {
  /** Six hex digits, resolved against the theme. */
  color: string
  /** How much of the cell it fills, from 0 to 1. */
  proportion: number
  /** A bar can be asked to stand in for the number rather than beside it. */
  showValue: boolean
}

/** Which icon of a set a cell earns. */
export interface CellIcon {
  set: string
  /** Counting from the bottom of the scale, after `reverse` has been applied. */
  index: number
  /** How many icons the set has, which is how the caller knows what to draw. */
  count: number
  showValue: boolean
}

export interface CellHighlight {
  /**
   * The `dxfs` a matching rule puts on the cell, most important first.
   *
   * A list rather than one format: a rule states only what it changes, and a
   * cell matching two rules takes the bold from the first and the fill from
   * the second, exactly as Excel layers them.
   */
  formats: number[]
  /** A colour scale's answer, as six hex digits. */
  scale: string | null
  bar: CellBar | null
  icon: CellIcon | null
}

export interface HighlightOptions {
  /** What a cell holds; null for a blank, which most cells are. */
  valueAt: (position: CellPosition) => HighlightValue | null
  /**
   * How far the sheet's cells reach.
   *
   * A rule written on a column header covers `A:A` — a million cells, almost
   * all of them empty. Clamping to the cells that exist is what keeps the cost
   * of such a rule the size of the data rather than the size of the format.
   */
  extent: { rows: number; columns: number }
  palette: ColorPalette
}

/**
 * What the rules of a block need to know about its range.
 *
 * Worked out once per block, on the first cell of it anybody asks about — a
 * sheet whose rules are never on screen never pays for them.
 */
interface RangeStats {
  /** Every number in the range, ascending. */
  numbers: number[]
  mean: number
  /** Over the range itself rather than a sample of it, which is what a rule means. */
  deviation: number
  /** How many cells hold each value, for the rules about repetition. */
  counts: Map<string, number>
}

/**
 * A function that answers what any one cell looks like under these rules.
 *
 * Returns null for a cell no rule covers, which is nearly all of them, and is
 * why this is cheap enough to call on every visible cell of every repaint.
 */
export function highlightsOf(
  formats: readonly ConditionalFormat[],
  options: HighlightOptions,
): (position: CellPosition) => CellHighlight | null {
  const stats = new Map<ConditionalFormat, RangeStats>()

  const statsOf = (format: ConditionalFormat): RangeStats => {
    const held = stats.get(format)
    if (held !== undefined) return held

    const made = measure(format.ranges, options)
    stats.set(format, made)
    return made
  }

  return (position) => {
    const covering = formats.filter((format) =>
      format.ranges.some((range) => rangeCovers(range, position)),
    )
    if (covering.length === 0) return null

    const value = options.valueAt(position)

    // Every rule that covers the cell, whichever block it came from, in the
    // order the file asks for. Two blocks can cover the same cell and their
    // priorities are one sequence, not two.
    const rules = covering
      .flatMap((format) => format.rules.map((rule) => ({ rule, format })))
      .sort((a, b) => a.rule.priority - b.rule.priority)

    const result: CellHighlight = { formats: [], scale: null, bar: null, icon: null }

    for (const { rule, format } of rules) {
      const applied = apply(rule, value, () => statsOf(format), options, result)

      // `stopIfTrue` is how a file says "and nothing below this". It was how
      // Excel 2003 expressed a rule that only paints when the ones above it
      // did not, and files written then are still opened now.
      if (applied && rule.stopIfTrue) break
    }

    return result.formats.length === 0 &&
      result.scale === null &&
      result.bar === null &&
      result.icon === null
      ? null
      : result
  }
}

/**
 * One rule against one cell, writing into what the rules before it decided.
 *
 * Returns whether it matched, which is what `stopIfTrue` turns on. The three
 * kinds that draw something — scale, bar, icon — are each taken from the first
 * rule that offers one, since a cell cannot have two backgrounds.
 */
function apply(
  rule: ConditionalRule,
  value: HighlightValue | null,
  stats: () => RangeStats,
  options: HighlightOptions,
  into: CellHighlight,
): boolean {
  if (rule.type === 'colorScale') {
    if (into.scale !== null || value === null || value.number === null) return false

    const scale = colorScaleAt(rule, value.number, stats(), options.palette)
    if (scale === null) return false

    into.scale = scale
    return true
  }

  if (rule.type === 'dataBar') {
    if (into.bar !== null || value === null || value.number === null) return false

    const bar = barAt(rule, value.number, stats(), options.palette)
    if (bar === null) return false

    into.bar = bar
    return true
  }

  if (rule.type === 'iconSet') {
    if (into.icon !== null || value === null || value.number === null) return false

    const icon = iconAt(rule, value.number, stats())
    if (icon === null) return false

    into.icon = icon
    return true
  }

  if (!matches(rule, value, stats)) return false

  // A rule can match and have nothing to show: `stopIfTrue` with no `dxfId` is
  // a rule whose whole purpose is to stop the ones below it.
  if (rule.dxfId !== null) into.formats.push(rule.dxfId)
  return true
}

/** Whether a condition holds for a value. */
function matches(
  rule: ConditionalRule,
  value: HighlightValue | null,
  stats: () => RangeStats,
): boolean {
  switch (rule.type) {
    case 'cellIs':
      return value === null ? false : compares(rule, value)
    case 'containsText':
    case 'notContainsText':
    case 'beginsWith':
    case 'endsWith':
      return textMatches(rule, value)
    case 'containsBlanks':
      return value === null || (value.text ?? '').trim() === ''
    case 'notContainsBlanks':
      return value !== null && (value.text ?? '').trim() !== ''
    case 'containsErrors':
      return value?.error === true
    case 'notContainsErrors':
      return value !== null && !value.error
    case 'top10':
      return value === null || value.number === null ? false : inTop(rule, value.number, stats())
    case 'aboveAverage':
      return value === null || value.number === null
        ? false
        : pastAverage(rule, value.number, stats())
    case 'duplicateValues':
    case 'uniqueValues': {
      if (value === null) return false

      const key = keyOf(value)
      if (key === null) return false

      const seen = stats().counts.get(key) ?? 0
      return rule.type === 'duplicateValues' ? seen > 1 : seen === 1
    }
    default:
      // `expression` and `timePeriod` land here: the first needs the formula
      // engine and the second needs to agree with Excel about what "today"
      // means in a file saved last year. Both are read and neither is guessed.
      return false
  }
}

/** `greaterThan`, `between` and the rest, against what the cell holds. */
function compares(rule: ConditionalRule, value: HighlightValue): boolean {
  const [first, second] = rule.formulas.map(literal)
  if (first === undefined || first === null) return false

  // A number is compared as a number and words as words; a rule comparing the
  // two is one Excel answers with its own type ordering, which is a question
  // for the engine rather than an answer to invent here.
  const pair = (operand: number | string): number | null => {
    if (typeof operand === 'number') return value.number === null ? null : value.number - operand
    if (value.number !== null) return null

    const text = (value.text ?? '').toUpperCase()
    const against = operand.toUpperCase()
    return text === against ? 0 : text < against ? -1 : 1
  }

  const order = pair(first)
  if (order === null) return false

  switch (rule.operator) {
    case 'lessThan':
      return order < 0
    case 'lessThanOrEqual':
      return order <= 0
    case 'equal':
      return order === 0
    case 'notEqual':
      return order !== 0
    case 'greaterThanOrEqual':
      return order >= 0
    case 'greaterThan':
      return order > 0
    case 'between':
    case 'notBetween': {
      if (second === undefined || second === null) return false

      const upper = pair(second)
      if (upper === null) return false

      const inside = order >= 0 && upper <= 0
      return rule.operator === 'between' ? inside : !inside
    }
    default:
      return false
  }
}

/**
 * The text rules, which Excel answers without regard to case.
 *
 * The word searched for is in the `text` attribute as well as in the formula
 * beside it; the attribute is read because the formula is `NOT(ISERROR(SEARCH(…)))`
 * and reading it would mean having the engine to read it with.
 */
function textMatches(rule: ConditionalRule, value: HighlightValue | null): boolean {
  const wanted = rule.text?.toUpperCase() ?? null
  if (wanted === null) return false

  const text = (value?.text ?? '').toUpperCase()

  switch (rule.type) {
    case 'containsText':
      return text.includes(wanted)
    case 'notContainsText':
      return !text.includes(wanted)
    case 'beginsWith':
      return text.startsWith(wanted)
    case 'endsWith':
      return text.endsWith(wanted)
    default:
      return false
  }
}

function inTop(rule: ConditionalRule, value: number, stats: RangeStats): boolean {
  const count = stats.numbers.length
  if (count === 0 || rule.rank === null) return false

  // "Top 10 %" of seven cells is none of them by arithmetic and one of them by
  // what anybody means, which is why Excel takes at least one.
  const wanted = Math.max(
    1,
    Math.min(count, rule.percent ? Math.floor((count * rule.rank) / 100) : rule.rank),
  )

  // Ties are included rather than cut: three cells sharing the third-highest
  // value are all in the top three, and choosing between them would mean
  // choosing by position.
  return rule.bottom
    ? value <= (stats.numbers[wanted - 1] ?? Number.NEGATIVE_INFINITY)
    : value >= (stats.numbers[count - wanted] ?? Number.POSITIVE_INFINITY)
}

function pastAverage(rule: ConditionalRule, value: number, stats: RangeStats): boolean {
  if (stats.numbers.length === 0) return false

  if (rule.standardDeviation !== null) {
    const away = stats.deviation * rule.standardDeviation
    return rule.above ? value > stats.mean + away : value < stats.mean - away
  }

  if (rule.equalAverage) return rule.above ? value >= stats.mean : value <= stats.mean
  return rule.above ? value > stats.mean : value < stats.mean
}

function colorScaleAt(
  rule: ConditionalRule,
  value: number,
  stats: RangeStats,
  palette: ColorPalette,
): string | null {
  const scale = rule.colorScale
  if (scale === null || scale.values.length < 2 || scale.colors.length < scale.values.length) {
    return null
  }

  const stops = scale.values.flatMap((entry, at) => {
    const threshold = thresholdOf(entry, stats)
    const color = resolveColor(scale.colors[at] ?? null, palette)
    return threshold === null || color === null ? [] : [{ threshold, color }]
  })
  if (stops.length !== scale.values.length) return null

  stops.sort((a, b) => a.threshold - b.threshold)

  const first = stops[0]
  const last = stops[stops.length - 1]
  if (first === undefined || last === undefined) return null
  if (value <= first.threshold) return first.color
  if (value >= last.threshold) return last.color

  for (let at = 1; at < stops.length; at += 1) {
    const low = stops[at - 1]
    const high = stops[at]
    if (low === undefined || high === undefined || value > high.threshold) continue

    const span = high.threshold - low.threshold
    return blend(low.color, high.color, span === 0 ? 0 : (value - low.threshold) / span)
  }

  return last.color
}

function barAt(
  rule: ConditionalRule,
  value: number,
  stats: RangeStats,
  palette: ColorPalette,
): CellBar | null {
  const bar = rule.dataBar
  if (bar === null) return null

  const color = resolveColor(bar.color, palette)
  if (color === null) return null

  const lower = thresholdOf(bar.lower, stats)
  const upper = thresholdOf(bar.upper, stats)
  if (lower === null || upper === null) return null

  // A range where every value is the same has no proportion to speak of, and
  // Excel fills every bar: they are all equally the largest.
  const place = upper <= lower ? 1 : Math.min(1, Math.max(0, (value - lower) / (upper - lower)))
  const length = bar.minLength + (bar.maxLength - bar.minLength) * place

  return { color, proportion: length / 100, showValue: bar.showValue }
}

function iconAt(rule: ConditionalRule, value: number, stats: RangeStats): CellIcon | null {
  const set = rule.iconSet
  if (set === null || set.values.length < 2) return null

  // The first `cfvo` is the floor of the scale and every value passes it; the
  // rest are the steps between one icon and the next.
  const steps = set.values.slice(1).map((entry) => ({
    threshold: thresholdOf(entry, stats),
    inclusive: entry.inclusive,
  }))
  if (steps.some((step) => step.threshold === null)) return null

  let index = 0
  for (const step of steps) {
    const threshold = step.threshold ?? 0
    if (step.inclusive ? value >= threshold : value > threshold) index += 1
  }

  const count = set.values.length
  return {
    set: set.name,
    index: set.reverse ? count - 1 - index : index,
    count,
    showValue: set.showValue,
  }
}

/** What a `cfvo` comes to, once the range it measures against is known. */
function thresholdOf(entry: ConditionalValue, stats: RangeStats): number | null {
  const numbers = stats.numbers
  const low = numbers[0] ?? 0
  const high = numbers[numbers.length - 1] ?? 0

  switch (entry.type) {
    case 'min':
      return low
    case 'max':
      return high
    case 'percent': {
      const fraction = Number(entry.value)
      return Number.isFinite(fraction) ? low + ((high - low) * fraction) / 100 : null
    }
    case 'percentile': {
      const fraction = Number(entry.value)
      return Number.isFinite(fraction) ? percentile(numbers, fraction / 100) : null
    }
    case 'formula': {
      // A constant written as a formula is still a constant; anything that
      // reaches for another cell waits for the engine.
      const value = literal(entry.value ?? '')
      return typeof value === 'number' ? value : null
    }
    default: {
      const value = Number(entry.value)
      return Number.isFinite(value) ? value : null
    }
  }
}

/**
 * The value a fraction of the way through a sorted list, interpolating.
 *
 * Excel's own `PERCENTILE.INC`: the 50th percentile of four numbers is between
 * the second and the third, not one of them.
 */
function percentile(numbers: readonly number[], fraction: number): number | null {
  if (numbers.length === 0) return null
  if (numbers.length === 1) return numbers[0] ?? null

  const place = Math.min(1, Math.max(0, fraction)) * (numbers.length - 1)
  const below = Math.floor(place)
  const above = Math.ceil(place)

  const low = numbers[below] ?? 0
  const high = numbers[above] ?? low
  return low + (high - low) * (place - below)
}

/**
 * A formula that is only a value.
 *
 * `100`, `"Done"`, `TRUE` — what nearly every comparison rule holds. A formula
 * that is anything more gives null, and the rule holding it is left out.
 */
function literal(formula: string): number | string | null {
  const text = formula.trim().replace(/^=/u, '').trim()
  if (text === '') return null

  const quoted = /^"(.*)"$/su.exec(text)
  if (quoted !== null) return quoted[1]?.replace(/""/gu, '"') ?? ''

  const value = Number(text)
  if (Number.isFinite(value)) return value

  const upper = text.toUpperCase()
  if (upper === 'TRUE' || upper === 'FALSE') return upper

  return null
}

/** How a value is counted for the rules about repetition. */
function keyOf(value: HighlightValue): string | null {
  if (value.number !== null) return `n:${String(value.number)}`

  const text = value.text ?? ''
  // Blanks do not repeat: a column of two filled cells and a hundred empty
  // ones has two values in it, not a hundred and two.
  return text === '' ? null : `t:${text.toUpperCase()}`
}

/**
 * Two colours mixed, channel by channel, as a colour scale mixes them.
 *
 * In RGB rather than anywhere perceptually better, because matching Excel is
 * the whole point: a scale interpolated in a nicer space would be a nicer
 * gradient and a different one from the file's.
 */
function blend(from: string, to: string, at: number): string {
  // Eight digits is `AARRGGBB`; the alpha is dropped rather than blended,
  // since nothing in a spreadsheet draws a translucent cell.
  const six = (hex: string) => (hex.length === 8 ? hex.slice(2) : hex.padStart(6, '0'))
  const low = six(from)
  const high = six(to)

  const mix = (offset: number) => {
    const start = Number.parseInt(low.slice(offset, offset + 2), 16)
    const end = Number.parseInt(high.slice(offset, offset + 2), 16)
    if (!Number.isFinite(start) || !Number.isFinite(end)) return 0

    return Math.round(start + (end - start) * at)
  }

  return [0, 2, 4].map((offset) => mix(offset).toString(16).padStart(2, '0').toUpperCase()).join('')
}

/** Everything the rules of a block need to know about the cells it covers. */
function measure(ranges: readonly CellRange[], options: HighlightOptions): RangeStats {
  const numbers: number[] = []
  const counts = new Map<string, number>()

  for (const range of ranges) {
    const top = Math.max(0, Math.min(range.from.row, range.to.row))
    const bottom = Math.min(options.extent.rows - 1, Math.max(range.from.row, range.to.row))
    const left = Math.max(0, Math.min(range.from.column, range.to.column))
    const right = Math.min(options.extent.columns - 1, Math.max(range.from.column, range.to.column))

    for (let row = top; row <= bottom; row += 1) {
      for (let column = left; column <= right; column += 1) {
        const value = options.valueAt({ row, column })
        if (value === null) continue

        if (value.number !== null) numbers.push(value.number)

        const key = keyOf(value)
        if (key !== null) counts.set(key, (counts.get(key) ?? 0) + 1)
      }
    }
  }

  numbers.sort((a, b) => a - b)

  const total = numbers.reduce((sum, one) => sum + one, 0)
  const mean = numbers.length === 0 ? 0 : total / numbers.length
  const variance =
    numbers.length === 0
      ? 0
      : numbers.reduce((sum, one) => sum + (one - mean) ** 2, 0) / numbers.length

  return { numbers, mean, deviation: Math.sqrt(variance), counts }
}
