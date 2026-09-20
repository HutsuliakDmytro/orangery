import { attribute, children, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { formatReference, parseRange } from './reference'
import type { CellRange } from './reference'

/**
 * `<autoFilter>` — the arrows on a header row, and what they are hiding.
 *
 * A filter is two separate things wearing one name. There is the range it
 * covers, which is what puts an arrow on each header cell; and there are the
 * criteria, one set per column, which say which rows survive. A sheet can
 * have the first without the second — arrows on, nothing filtered — and that
 * is the ordinary state of a table somebody has turned filtering on for.
 *
 * What the file does *not* say is which rows are hidden. That is written on
 * the rows themselves, as `hidden`, and a reader that trusted the criteria
 * instead would show rows Excel had hidden and hide rows it had not. The
 * criteria are the reason; the rows carry the result.
 */

/**
 * How a column decides, in the file's own two ways.
 *
 * A column holds a list of values or a pair of conditions, never both: that
 * is how `<filterColumn>` is written, and a model that allowed both would be
 * a model with states no file can hold.
 */
export type FilterCriteria =
  | {
      kind: 'values'
      /**
       * The values that pass, as they are shown.
       *
       * A filter compares against what a cell displays rather than what it
       * holds, which is why a date filtered by `2026-01-01` matches a cell
       * holding 46023.
       */
      values: string[]
      /** Whether empty cells pass, which the file says separately. */
      blanks: boolean
    }
  | {
      kind: 'conditions'
      /** Whether both must hold. Excel writes `and="1"`, and means it. */
      all: boolean
      conditions: FilterCondition[]
    }

/**
 * One test a value has to get past.
 *
 * The file's vocabulary rather than a friendlier one: six operators and a
 * value that may hold `*` and `?`. "Contains" is not an operator in a
 * spreadsheet — it is `equal` against `*text*` — and keeping the file's
 * spelling is what lets a filter written in Excel be read, judged and written
 * back as the same filter.
 */
export interface FilterCondition {
  operator:
    'equal' | 'notEqual' | 'greaterThan' | 'greaterThanOrEqual' | 'lessThan' | 'lessThanOrEqual'
  value: string
}

/** What one column keeps. */
export interface FilterColumn {
  /** Counting from the left of the filter's own range, as the file does. */
  column: number
  criteria: FilterCriteria
}

export interface AutoFilter {
  range: CellRange
  /** Only the columns with criteria on them; the rest let everything through. */
  columns: FilterColumn[]
}

export function readAutoFilter(node: XmlNode | undefined): AutoFilter | null {
  if (node === undefined) return null

  const range = parseRange(attribute(node, 'ref') ?? '')
  if (range === null) return null

  const columns = children(node).flatMap((child): FilterColumn[] => {
    if (tagName(child) !== 'filterColumn') return []

    const column = Number(attribute(child, 'colId'))
    if (!Number.isFinite(column)) return []

    const filters = children(child).find((one) => tagName(one) === 'filters')
    if (filters !== undefined) {
      return [
        {
          column,
          criteria: {
            kind: 'values',
            values: children(filters).flatMap((one) => {
              const value = tagName(one) === 'filter' ? attribute(one, 'val') : undefined
              return value === undefined ? [] : [value]
            }),
            // `blank="1"` is how the element says empty cells are kept, and it
            // is separate because "" is a value a cell can hold.
            blanks: attribute(filters, 'blank') === '1',
          },
        },
      ]
    }

    const custom = children(child).find((one) => tagName(one) === 'customFilters')
    if (custom === undefined) return []

    const conditions = children(custom).flatMap((one): FilterCondition[] => {
      if (tagName(one) !== 'customFilter') return []
      const value = attribute(one, 'val')
      if (value === undefined) return []

      // `equal` is the default the schema states, and the one Excel leaves
      // out for a plain "contains".
      return [{ operator: operatorOf(attribute(one, 'operator')), value }]
    })

    if (conditions.length === 0) return []
    return [
      {
        column,
        criteria: { kind: 'conditions', all: attribute(custom, 'and') === '1', conditions },
      },
    ]
  })

  return { range, columns }
}

const OPERATORS = [
  'equal',
  'notEqual',
  'greaterThan',
  'greaterThanOrEqual',
  'lessThan',
  'lessThanOrEqual',
] as const

const operatorOf = (stated: string | undefined): FilterCondition['operator'] =>
  OPERATORS.find((one) => one === stated) ?? 'equal'

/** The filter with one column's criteria changed, or cleared where none pass. */
export function withFilter(
  filter: AutoFilter,
  column: number,
  criteria: FilterCriteria | null,
): AutoFilter {
  const rest = filter.columns.filter((one) => one.column !== column)
  if (criteria === null) return { ...filter, columns: rest }

  return {
    ...filter,
    columns: [...rest, { column, criteria }].sort((a, b) => a.column - b.column),
  }
}

/**
 * Whether a value gets past a column's criteria.
 *
 * Numbers are compared as numbers where both sides are numbers, and as words
 * otherwise. That is Excel's rule and the only one that makes `greater than
 * 9` keep 100: a comparison that read the column as text would drop it.
 */
export function passes(column: FilterColumn | undefined, shown: string): boolean {
  if (column === undefined) return true

  const criteria = column.criteria
  if (criteria.kind === 'values') {
    if (shown === '') return criteria.blanks
    return criteria.values.includes(shown)
  }

  const met = criteria.conditions.map((one) => holds(one, shown))
  return criteria.all ? met.every(Boolean) : met.some(Boolean)
}

/** Whether one value gets past one condition. */
function holds(condition: FilterCondition, shown: string): boolean {
  const { operator, value } = condition

  if (operator === 'equal' || operator === 'notEqual') {
    const same = matches(value, shown)
    return operator === 'equal' ? same : !same
  }

  const here = Number(shown)
  const there = Number(value)
  const order =
    shown !== '' && value !== '' && Number.isFinite(here) && Number.isFinite(there)
      ? here - there
      : shown.localeCompare(value)

  if (operator === 'greaterThan') return order > 0
  if (operator === 'greaterThanOrEqual') return order >= 0
  if (operator === 'lessThan') return order < 0
  return order <= 0
}

/**
 * A value against a pattern, where `*` stands for anything and `?` for one.
 *
 * Case is ignored, as it is everywhere else a spreadsheet compares words:
 * a filter for `north` that missed `North` would be a filter people think is
 * broken, and they would be right.
 */
function matches(pattern: string, shown: string): boolean {
  if (!/[*?~]/u.test(pattern)) return shown.toLocaleUpperCase() === pattern.toLocaleUpperCase()

  let expression = ''

  for (let at = 0; at < pattern.length; at += 1) {
    const here = pattern[at] ?? ''

    // A tilde is how a spreadsheet says the next wildcard is a letter: a
    // filter for a part number with a star in it has to be possible.
    if (here === '~' && (pattern[at + 1] === '*' || pattern[at + 1] === '?')) {
      expression += escapedForRegExp(pattern[at + 1] ?? '')
      at += 1
      continue
    }

    expression += here === '*' ? '[\\s\\S]*' : here === '?' ? '[\\s\\S]' : escapedForRegExp(here)
  }

  return new RegExp(`^${expression}$`, 'iu').test(shown)
}

const escapedForRegExp = (text: string): string => text.replace(/[.*+^${}()|[\]\\?]/gu, '\\$&')

const escaped = (text: string): string =>
  text.replace(
    /[&<>"]/gu,
    (one) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[one] ?? ''};`,
  )

/** The filter as the element a worksheet keeps it in, or nothing for none. */
export function writeAutoFilter(filter: AutoFilter | null): string {
  if (filter === null) return ''

  const bounds = {
    top: Math.min(filter.range.from.row, filter.range.to.row),
    bottom: Math.max(filter.range.from.row, filter.range.to.row),
    left: Math.min(filter.range.from.column, filter.range.to.column),
    right: Math.max(filter.range.from.column, filter.range.to.column),
  }

  const ref = `${formatReference({ row: bounds.top, column: bounds.left })}:${formatReference({
    row: bounds.bottom,
    column: bounds.right,
  })}`

  const columns = filter.columns
    .map((one) => {
      const inside =
        one.criteria.kind === 'values'
          ? `<filters${one.criteria.blanks ? ' blank="1"' : ''}>` +
            one.criteria.values.map((value) => `<filter val="${escaped(value)}"/>`).join('') +
            '</filters>'
          : `<customFilters${one.criteria.all ? ' and="1"' : ''}>` +
            one.criteria.conditions
              .map(
                (condition) =>
                  `<customFilter operator="${condition.operator}" val="${escaped(condition.value)}"/>`,
              )
              .join('') +
            '</customFilters>'

      return `<filterColumn colId="${String(one.column)}">${inside}</filterColumn>`
    })
    .join('')

  return columns === ''
    ? `<autoFilter ref="${ref}"/>`
    : `<autoFilter ref="${ref}">${columns}</autoFilter>`
}

/**
 * A worksheet with its `<autoFilter>` replaced and everything else left alone.
 *
 * After `<mergeCells>`, which is where the schema puts it. Textual, like
 * everything else this app edits inside a worksheet
 * (`apps/sheets/docs/adr/0002-xlsx-roundtrip.md`).
 */
export function replaceAutoFilter(xml: string, filter: AutoFilter | null): string {
  const written = writeAutoFilter(filter)
  const existing = /<autoFilter(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/autoFilter>)/u.exec(xml)

  if (existing !== null) {
    return xml.slice(0, existing.index) + written + xml.slice(existing.index + existing[0].length)
  }

  if (written === '') return xml

  const after =
    /<mergeCells(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/mergeCells>)/u.exec(xml) ??
    /<\/sheetData>|<sheetData(?:\s[^>]*)?\/>/u.exec(xml)
  if (after === null) return xml

  const at = after.index + after[0].length
  return xml.slice(0, at) + written + xml.slice(at)
}
