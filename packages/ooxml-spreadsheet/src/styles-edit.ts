import { formatCodeOf } from './styles'
import type { Alignment, CellFormat, Styles } from './styles'

/**
 * Giving a cell a look the file did not already have.
 *
 * A workbook does not store formatting on its cells. It stores a list of
 * formats and an index per cell, and the same dozen entries serve a million
 * cells — which is why a spreadsheet stays small, and why a writer that gave
 * each cell its own entry would produce a file every other reader opens
 * slowly. So making a cell show a percentage is not "set its format"; it is
 * "find the entry that says percentage, or add one, and point the cell at it".
 *
 * Everything added is recorded, because `styles.xml` is patched rather than
 * regenerated — the same tier-two rule the worksheet follows
 * (`apps/sheets/docs/adr/0002-xlsx-roundtrip.md`). A file that came in with
 * forty-one fonts and one table style goes out with all of them, plus whatever
 * was needed, in the order the format demands.
 */

export interface StyleChanges {
  /** Codes added to `numFmts`, by the id each was given. */
  numberFormats: Map<number, string>
  /** Entries appended to `cellXfs`, in the order they were added. */
  cellFormats: CellFormat[]
}

export const noStyleChanges = (): StyleChanges => ({
  numberFormats: new Map(),
  cellFormats: [],
})

/** Where custom format ids start; everything below is Excel's own. */
const FIRST_CUSTOM_FORMAT = 164

const EMPTY_FORMAT: CellFormat = {
  numberFormat: 0,
  font: 0,
  fill: 0,
  border: 0,
  basedOn: 0,
  alignment: null,
  applies: {
    numberFormat: false,
    font: false,
    fill: false,
    border: false,
    alignment: false,
  },
  locked: true,
  hidden: false,
}

const sameAlignment = (a: Alignment | null, b: Alignment | null): boolean => {
  if (a === null || b === null) return a === b

  return (
    a.horizontal === b.horizontal &&
    a.vertical === b.vertical &&
    a.wrapText === b.wrapText &&
    a.indent === b.indent &&
    a.textRotation === b.textRotation &&
    a.shrinkToFit === b.shrinkToFit
  )
}

/** Whether two entries would look the same, which is when one of them is spare. */
export function sameCellFormat(a: CellFormat, b: CellFormat): boolean {
  return (
    a.numberFormat === b.numberFormat &&
    a.font === b.font &&
    a.fill === b.fill &&
    a.border === b.border &&
    a.basedOn === b.basedOn &&
    a.locked === b.locked &&
    a.hidden === b.hidden &&
    a.applies.numberFormat === b.applies.numberFormat &&
    a.applies.font === b.applies.font &&
    a.applies.fill === b.applies.fill &&
    a.applies.border === b.applies.border &&
    a.applies.alignment === b.applies.alignment &&
    sameAlignment(a.alignment, b.alignment)
  )
}

/**
 * The index of an entry equal to this one, adding it when there is none.
 *
 * The deduplication the format expects: ask for the same look twice and get
 * the same index twice.
 */
export function cellFormatIndex(styles: Styles, changes: StyleChanges, wanted: CellFormat): number {
  const existing = styles.cellFormats.findIndex((one) => sameCellFormat(one, wanted))
  if (existing !== -1) return existing

  styles.cellFormats.push(wanted)
  changes.cellFormats.push(wanted)
  return styles.cellFormats.length - 1
}

/**
 * The id a format code has in this workbook, giving it one if it has none.
 *
 * The built-in ids are checked first and are never added: a file that declared
 * `0%` as a custom format alongside Excel's own id 9 would be a file with two
 * names for one thing, and Excel rewrites it on save.
 */
export function numberFormatId(styles: Styles, changes: StyleChanges, code: string): number {
  for (const [id, stated] of styles.numberFormats) {
    if (stated === code) return id
  }

  // Excel's own, which are not in the file and cannot be added to it.
  for (let id = 0; id <= 49; id += 1) {
    if (styles.numberFormats.has(id)) continue
    if (formatCodeOf(styles, id) === code) return id
  }

  const used = [...styles.numberFormats.keys(), ...changes.numberFormats.keys()]
  const next = Math.max(FIRST_CUSTOM_FORMAT - 1, ...used) + 1

  styles.numberFormats.set(next, code)
  changes.numberFormats.set(next, code)
  return next
}

/**
 * A cell's style index, changed to show this format code.
 *
 * Everything else about the cell's look is kept: a bold cell that becomes a
 * percentage is still bold, which is the whole reason this starts from the
 * entry the cell already points at rather than from a blank one.
 */
export function styleShowing(
  styles: Styles,
  changes: StyleChanges,
  from: number | null,
  code: string,
): number {
  const base = styles.cellFormats[from ?? 0] ?? EMPTY_FORMAT
  const id = numberFormatId(styles, changes, code)

  if (base.numberFormat === id && base.applies.numberFormat) return from ?? 0

  return cellFormatIndex(styles, changes, {
    ...base,
    numberFormat: id,
    applies: { ...base.applies, numberFormat: true },
  })
}

const attribute = (name: string, value: string | number | null): string =>
  value === null ? '' : ` ${name}="${String(value)}"`

const escaped = (text: string): string =>
  text.replace(
    /[&<>"]/gu,
    (one) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[one] ?? ''};`,
  )

function alignmentXml(alignment: Alignment | null): string {
  if (alignment === null) return ''

  return (
    '<alignment' +
    attribute('horizontal', alignment.horizontal) +
    attribute('vertical', alignment.vertical) +
    (alignment.wrapText ? ' wrapText="1"' : '') +
    (alignment.indent === 0 ? '' : attribute('indent', alignment.indent)) +
    attribute('textRotation', alignment.textRotation) +
    (alignment.shrinkToFit ? ' shrinkToFit="1"' : '') +
    '/>'
  )
}

function cellFormatXml(format: CellFormat): string {
  const head =
    '<xf' +
    attribute('numFmtId', format.numberFormat) +
    attribute('fontId', format.font) +
    attribute('fillId', format.fill) +
    attribute('borderId', format.border) +
    attribute('xfId', format.basedOn) +
    (format.applies.numberFormat ? ' applyNumberFormat="1"' : '') +
    (format.applies.font ? ' applyFont="1"' : '') +
    (format.applies.fill ? ' applyFill="1"' : '') +
    (format.applies.border ? ' applyBorder="1"' : '') +
    (format.applies.alignment ? ' applyAlignment="1"' : '')

  const body = alignmentXml(format.alignment)
  return body === '' ? `${head}/>` : `${head}>${body}</xf>`
}

/**
 * `styles.xml` with what was added put into it.
 *
 * Textual, and in the two places the schema allows: `numFmts` comes first of
 * everything inside `styleSheet`, and new entries go at the end of `cellXfs`
 * because a cell's index is its position — inserting anywhere else would
 * silently restyle every cell after the insertion.
 */
export function patchStyles(xml: string, changes: StyleChanges): string {
  if (changes.numberFormats.size === 0 && changes.cellFormats.length === 0) return xml

  let patched = xml

  if (changes.numberFormats.size > 0) {
    const added = [...changes.numberFormats]
      .sort((a, b) => a[0] - b[0])
      .map(([id, code]) => `<numFmt numFmtId="${String(id)}" formatCode="${escaped(code)}"/>`)
      .join('')

    const existing = /<numFmts(?:\s[^>]*)?>([\s\S]*?)<\/numFmts>/u.exec(patched)
    if (existing === null) {
      // A file with no custom formats has no element for them, and it belongs
      // before the fonts rather than wherever there is room.
      const opened = /<styleSheet(?:\s[^>]*)?>/u.exec(patched)
      const count = changes.numberFormats.size
      if (opened !== null) {
        const at = opened.index + opened[0].length
        patched =
          patched.slice(0, at) +
          `<numFmts count="${String(count)}">${added}</numFmts>` +
          patched.slice(at)
      }
    } else {
      const inside = existing[1] ?? ''
      const count = (inside.match(/<numFmt\b/gu)?.length ?? 0) + changes.numberFormats.size
      patched =
        patched.slice(0, existing.index) +
        `<numFmts count="${String(count)}">${inside}${added}</numFmts>` +
        patched.slice(existing.index + existing[0].length)
    }
  }

  if (changes.cellFormats.length > 0) {
    const added = changes.cellFormats.map((format) => cellFormatXml(format)).join('')
    const existing = /<cellXfs(?:\s[^>]*)?>([\s\S]*?)<\/cellXfs>/u.exec(patched)
    if (existing === null) return patched

    const inside = existing[1] ?? ''
    const count = (inside.match(/<xf\b/gu)?.length ?? 0) + changes.cellFormats.length
    patched =
      patched.slice(0, existing.index) +
      `<cellXfs count="${String(count)}">${inside}${added}</cellXfs>` +
      patched.slice(existing.index + existing[0].length)
  }

  return patched
}
