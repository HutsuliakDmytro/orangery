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

/** What one column keeps, by the values it will let through. */
export interface FilterColumn {
  /** Counting from the left of the filter's own range, as the file does. */
  column: number
  /**
   * The values that pass, as they are shown.
   *
   * A filter compares against what a cell displays rather than what it holds,
   * which is why a date filtered by `2026-01-01` matches a cell holding 46023.
   */
  values: string[]
  /** Whether empty cells pass, which the file says separately. */
  blanks: boolean
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
    if (filters === undefined) return []

    return [
      {
        column,
        values: children(filters).flatMap((one) => {
          const value = tagName(one) === 'filter' ? attribute(one, 'val') : undefined
          return value === undefined ? [] : [value]
        }),
        // `blank="1"` is how the element says empty cells are kept, and it is
        // separate because "" is a value a cell can hold.
        blanks: attribute(filters, 'blank') === '1',
      },
    ]
  })

  return { range, columns }
}

/** The filter with one column's criteria changed, or cleared where none pass. */
export function withFilter(
  filter: AutoFilter,
  column: number,
  criteria: { values: string[]; blanks: boolean } | null,
): AutoFilter {
  const rest = filter.columns.filter((one) => one.column !== column)
  if (criteria === null) return { ...filter, columns: rest }

  return {
    ...filter,
    columns: [...rest, { column, ...criteria }].sort((a, b) => a.column - b.column),
  }
}

/** Whether a value gets past a column's criteria. */
export function passes(criteria: FilterColumn | undefined, shown: string): boolean {
  if (criteria === undefined) return true
  if (shown === '') return criteria.blanks

  return criteria.values.includes(shown)
}

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
    .map(
      (one) =>
        `<filterColumn colId="${String(one.column)}">` +
        `<filters${one.blanks ? ' blank="1"' : ''}>` +
        one.values.map((value) => `<filter val="${escaped(value)}"/>`).join('') +
        '</filters></filterColumn>',
    )
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
