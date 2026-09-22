import type { ColumnRange } from './worksheet'
import { elementPattern, openingPattern } from './patterns'

/**
 * `<cols>` — what a worksheet says about its columns.
 *
 * Stated in runs rather than one entry per column, because a sheet has sixteen
 * thousand of them and almost all are the same: `min="1" max="16384"` is one
 * element saying "every column looks like this". Which means changing one
 * column is not "set its width" but "split the run it is in, change the middle,
 * and join up whatever now matches its neighbours" — and a writer that skipped
 * the joining would produce a file that grew a run on every drag.
 *
 * Rows need none of this. A row's height is an attribute of the row itself and
 * travels with it through `sheetData`; only columns keep their properties
 * somewhere else.
 */

/** What can be said about a run of columns, apart from which columns it is. */
export type ColumnLook = Omit<ColumnRange, 'from' | 'to'>

const DEFAULT_LOOK: ColumnLook = {
  width: null,
  hidden: false,
  custom: false,
  style: null,
  outlineLevel: null,
  collapsed: false,
  carried: null,
}

const carriedAlike = (a: ColumnLook['carried'], b: ColumnLook['carried']): boolean =>
  JSON.stringify(a ?? {}) === JSON.stringify(b ?? {})

const sameLook = (a: ColumnLook, b: ColumnLook): boolean =>
  a.width === b.width &&
  a.hidden === b.hidden &&
  a.custom === b.custom &&
  a.style === b.style &&
  a.outlineLevel === b.outlineLevel &&
  a.collapsed === b.collapsed &&
  // Two runs that differ only in what they carry are still two runs: joining
  // them would drop one side's attributes, which is what carrying is against.
  carriedAlike(a.carried, b.carried)

const lookOf = (range: ColumnRange): ColumnLook => ({
  width: range.width,
  hidden: range.hidden,
  custom: range.custom,
  style: range.style,
  outlineLevel: range.outlineLevel,
  collapsed: range.collapsed,
  carried: range.carried,
})

/**
 * The runs with something changed about the columns from `from` to `to`.
 *
 * Everything outside the span keeps what it had; everything inside takes the
 * change over whatever it had, so making a column hidden does not also reset
 * its width. Runs that end up alike are joined, and a span nothing covered
 * gets a run of its own.
 */
export function withColumns(
  columns: readonly ColumnRange[],
  from: number,
  to: number,
  change: Partial<ColumnLook>,
): ColumnRange[] {
  const first = Math.min(from, to)
  const last = Math.max(from, to)

  // Per column across everything the answer could touch. A sheet has a few
  // runs and this span is what somebody selected, so the list is short — and
  // building it explicitly is what makes the splitting obvious rather than
  // clever.
  const looks = new Map<number, ColumnLook>()

  for (const range of columns) {
    for (let at = range.from; at <= range.to; at += 1) looks.set(at, lookOf(range))
  }

  for (let at = first; at <= last; at += 1) {
    looks.set(at, { ...(looks.get(at) ?? DEFAULT_LOOK), ...change })
  }

  const ordered = [...looks.entries()].sort((a, b) => a[0] - b[0])
  const merged: ColumnRange[] = []

  for (const [index, look] of ordered) {
    const previous = merged[merged.length - 1]

    // Joined only when they touch: two runs of the same width with a gap
    // between them are two runs, and a file that said otherwise would claim
    // a width for the columns in between.
    if (previous !== undefined && previous.to === index - 1 && sameLook(lookOf(previous), look)) {
      previous.to = index
      continue
    }

    merged.push({ from: index, to: index, ...look })
  }

  // A run that says nothing is a run the file is better without.
  return merged.filter((range) => !sameLook(lookOf(range), DEFAULT_LOOK))
}

/** The width a column is shown at, or null where it takes the sheet's own. */
export const widthOfColumnIn = (columns: readonly ColumnRange[], column: number): number | null =>
  columns.find((range) => column >= range.from && column <= range.to)?.width ?? null

const attribute = (name: string, value: string | number | null): string =>
  value === null ? '' : ` ${name}="${String(value)}"`

/** The attributes the model does not hold, written back as they were read. */
const carriedAttributes = (carried: Record<string, string> | null): string =>
  carried === null
    ? ''
    : Object.entries(carried)
        .map(([name, value]) => ` ${name}="${value}"`)
        .join('')

/** The runs as the element a worksheet keeps them in, or nothing for none. */
export function writeColumns(columns: readonly ColumnRange[]): string {
  if (columns.length === 0) return ''

  const runs = columns
    .map(
      (range) =>
        '<col' +
        // The file counts from one, which is the only place it does and the
        // easiest place to be out by one.
        ` min="${String(range.from + 1)}" max="${String(range.to + 1)}"` +
        attribute('width', range.width) +
        (range.custom || range.width !== null ? ' customWidth="1"' : '') +
        (range.hidden ? ' hidden="1"' : '') +
        // `style` alone: `customFormat` is a row's attribute, and writing it
        // on a column added markup Excel had not put there.
        attribute('style', range.style) +
        attribute('outlineLevel', range.outlineLevel) +
        (range.collapsed ? ' collapsed="1"' : '') +
        carriedAttributes(range.carried) +
        '/>',
    )
    .join('')

  return `<cols>${runs}</cols>`
}

/**
 * A worksheet with its `<cols>` replaced and everything else left alone.
 *
 * Textual, like the cells: every other element of the part keeps its own bytes
 * (`apps/sheets/docs/adr/0002-xlsx-roundtrip.md`). Where the part has no
 * `<cols>` the new one goes immediately before `<sheetData>`, which is where
 * the schema puts it and the only place Excel will read it from.
 */
export function replaceColumns(xml: string, columns: readonly ColumnRange[]): string {
  const written = writeColumns(columns)
  const existing = elementPattern('cols').exec(xml)

  if (existing !== null) {
    return xml.slice(0, existing.index) + written + xml.slice(existing.index + existing[0].length)
  }

  if (written === '') return xml

  const data = openingPattern('sheetData').exec(xml)
  if (data === null) return xml

  return xml.slice(0, data.index) + written + xml.slice(data.index)
}
