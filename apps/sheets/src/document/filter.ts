import { passes, regionAround, withFilter } from '@orangery/ooxml-spreadsheet'
import type { AutoFilter, FilterCondition, FilterCriteria } from '@orangery/ooxml-spreadsheet'
import type { Change } from './history'
import { resizeRows } from './structure'
import { shownText } from './shown'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * Filtering a table.
 *
 * Two halves that meet nowhere in the file. The criteria say which rows
 * should survive and live in `<autoFilter>`; which rows *are* hidden is
 * written on the rows themselves. Excel keeps both and so does this, because
 * a reader that recomputed the hiding from the criteria would disagree with
 * Excel about any row somebody had hidden by hand — and a reader that trusted
 * the hiding alone could not tell you why.
 *
 * So applying a filter is one operation that writes both: the reason, and
 * the result. Undo puts both back, which it can do because the hiding is
 * already a change the history understands.
 */

/** The values a column actually holds, in the order they are met. */
export function valuesIn(
  open: OpenWorkbook,
  sheet: OpenSheet,
  filter: AutoFilter,
  column: number,
): { values: string[]; blanks: boolean } {
  const top = Math.min(filter.range.from.row, filter.range.to.row)
  const bottom = Math.max(filter.range.from.row, filter.range.to.row)
  const at = Math.min(filter.range.from.column, filter.range.to.column) + column

  const seen = new Set<string>()
  let blanks = false

  // From the row below the header: the name of a column is not one of its
  // values, and offering it as one is how a filter ends up hiding the header.
  for (let row = top + 1; row <= bottom; row += 1) {
    const shown = shownText(open, sheet.cells.rows.get(row)?.get(at) ?? null)
    if (shown === '') blanks = true
    else seen.add(shown)
  }

  return { values: [...seen].sort((a, b) => a.localeCompare(b)), blanks }
}

/**
 * The filter on a sheet, and every row hidden or shown to match it.
 *
 * The header row is never hidden: it is what the arrows are on, and a filter
 * that hid its own controls would be one nobody could turn off.
 */
export function applyFilter(
  open: OpenWorkbook,
  sheet: OpenSheet,
  filter: AutoFilter | null,
): Change[] {
  const before = sheet.sheet.autoFilter
  sheet.sheet.autoFilter = filter

  const changes: Change[] = [{ kind: 'filter', sheet: sheet.path, before, after: filter }]

  const range = (filter ?? before)?.range
  if (range === undefined) return changes

  const top = Math.min(range.from.row, range.to.row)
  const bottom = Math.max(range.from.row, range.to.row)
  const out = new Set(rowsFilteredBy(open, sheet, filter))

  for (let row = top + 1; row <= bottom; row += 1) {
    const hidden = out.has(row)
    if ((sheet.cells.properties.get(row)?.hidden ?? false) === hidden) continue
    changes.push(...resizeRows(sheet, row, row, { hidden }))
  }

  return changes
}

/**
 * The rows a filter puts out of sight — which is not the same list as the
 * rows that are out of sight.
 *
 * A row's `hidden` flag says it cannot be seen and not why, because that is
 * all the file records. `SUBTOTAL` can tell the two apart — 9 leaves out what
 * a filter hid and 109 leaves out what somebody hid by hand — so the engine
 * has to be told which is which, and the only way to know is to ask the
 * filter again.
 *
 * The header row is never among them: it is what the arrows are on.
 */
export function rowsFilteredBy(
  open: OpenWorkbook,
  sheet: OpenSheet,
  filter: AutoFilter | null = sheet.sheet.autoFilter,
): number[] {
  const range = filter?.range
  if (filter === null || range === undefined) return []

  const top = Math.min(range.from.row, range.to.row)
  const bottom = Math.max(range.from.row, range.to.row)
  const left = Math.min(range.from.column, range.to.column)

  const out: number[] = []
  for (let row = top + 1; row <= bottom; row += 1) {
    const fails = filter.columns.some(
      (criteria) =>
        !passes(
          criteria,
          shownText(open, sheet.cells.rows.get(row)?.get(left + criteria.column) ?? null),
        ),
    )

    if (fails) out.push(row)
  }

  return out
}

/** Turns filtering on over the table a cell is in, or takes it off. */
export function toggleFilter(
  open: OpenWorkbook,
  sheet: OpenSheet,
  at: { row: number; column: number },
): Change[] {
  if (sheet.sheet.autoFilter !== null) return applyFilter(open, sheet, null)

  const range = regionAround(sheet.cells, at)
  // One cell is not a table, and arrows on it would filter its own header.
  if (range.from.row === range.to.row) return []

  return applyFilter(open, sheet, { range, columns: [] })
}

/** The criteria of one column, changed, with the rows brought into line. */
export function filterColumn(
  open: OpenWorkbook,
  sheet: OpenSheet,
  column: number,
  criteria: FilterCriteria | null,
): Change[] {
  const filter = sheet.sheet.autoFilter
  if (filter === null) return []

  return applyFilter(open, sheet, withFilter(filter, column, criteria))
}

/**
 * A test as somebody says it, and as the file spells it.
 *
 * A spreadsheet's file format has six operators and wildcards; a person has
 * "contains". The two are the same thing written differently — `contains` is
 * `equal` against `*text*` — and translating here rather than storing a
 * vocabulary of our own is what keeps a filter written in Excel readable as
 * the filter somebody meant.
 */
export type ConditionKind =
  | 'equals'
  | 'notEquals'
  | 'contains'
  | 'notContains'
  | 'beginsWith'
  | 'endsWith'
  | 'greaterThan'
  | 'greaterThanOrEqual'
  | 'lessThan'
  | 'lessThanOrEqual'

const escapedForMatching = (text: string): string => text.replace(/([*?])/gu, '~$1')

/** The condition a kind and a word come to. */
export function conditionFor(kind: ConditionKind, text: string): FilterCondition {
  const quoted = escapedForMatching(text)

  if (kind === 'contains') return { operator: 'equal', value: `*${quoted}*` }
  if (kind === 'notContains') return { operator: 'notEqual', value: `*${quoted}*` }
  if (kind === 'beginsWith') return { operator: 'equal', value: `${quoted}*` }
  if (kind === 'endsWith') return { operator: 'equal', value: `*${quoted}` }
  if (kind === 'equals') return { operator: 'equal', value: text }
  if (kind === 'notEquals') return { operator: 'notEqual', value: text }

  return { operator: kind, value: text }
}

/** The same thing backwards, for a filter that arrived in a file. */
export function conditionShown(condition: FilterCondition): {
  kind: ConditionKind
  text: string
} {
  const { operator, value } = condition
  const plain = operator === 'equal' || operator === 'notEqual'
  const no = operator === 'notEqual'

  if (plain && value.startsWith('*') && value.endsWith('*') && value.length > 1) {
    return { kind: no ? 'notContains' : 'contains', text: value.slice(1, -1) }
  }
  if (plain && value.endsWith('*')) {
    return { kind: no ? 'notEquals' : 'beginsWith', text: value.slice(0, -1) }
  }
  if (plain && value.startsWith('*')) {
    return { kind: no ? 'notEquals' : 'endsWith', text: value.slice(1) }
  }
  if (plain) return { kind: no ? 'notEquals' : 'equals', text: value }

  return { kind: operator, text: value }
}
