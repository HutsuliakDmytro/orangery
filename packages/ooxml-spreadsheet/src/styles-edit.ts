import { formatCodeOf, resolveStyle } from './styles'
import type {
  Alignment,
  Border,
  BorderEdge,
  CellFormat,
  Fill,
  Font,
  StyleColor,
  Styles,
} from './styles'

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
  fonts: Font[]
  fills: Fill[]
  borders: Border[]
}

export const noStyleChanges = (): StyleChanges => ({
  numberFormats: new Map(),
  cellFormats: [],
  fonts: [],
  fills: [],
  borders: [],
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

/** A colour, written the way the part it is going into writes one. */
function colorXml(tag: string, color: StyleColor | null): string {
  if (color === null) return ''

  if (color.kind === 'rgb') return `<${tag} rgb="${escaped(color.hex)}"/>`
  if (color.kind === 'theme') {
    const tint = color.tint === 0 ? '' : ` tint="${String(color.tint)}"`
    return `<${tag} theme="${String(color.index)}"${tint}/>`
  }
  if (color.kind === 'indexed') return `<${tag} indexed="${String(color.index)}"/>`

  return `<${tag} auto="1"/>`
}

function fontXml(font: Font): string {
  // In the order the schema lists them, because a reader that validates will
  // reject a font whose `sz` comes after its `name`.
  return (
    '<font>' +
    (font.bold ? '<b/>' : '') +
    (font.italic ? '<i/>' : '') +
    (font.strike ? '<strike/>' : '') +
    (font.underline === null ? '' : `<u val="${escaped(font.underline)}"/>`) +
    (font.vertAlign === null ? '' : `<vertAlign val="${escaped(font.vertAlign)}"/>`) +
    (font.size === null ? '' : `<sz val="${String(font.size)}"/>`) +
    colorXml('color', font.color) +
    (font.name === null ? '' : `<name val="${escaped(font.name)}"/>`) +
    (font.scheme === null ? '' : `<scheme val="${escaped(font.scheme)}"/>`) +
    '</font>'
  )
}

function fillXml(fill: Fill): string {
  const pattern = fill.pattern ?? 'none'
  const inside = colorXml('fgColor', fill.foreground) + colorXml('bgColor', fill.background)

  return inside === ''
    ? `<fill><patternFill patternType="${escaped(pattern)}"/></fill>`
    : `<fill><patternFill patternType="${escaped(pattern)}">${inside}</patternFill></fill>`
}

function edgeXml(tag: string, edge: BorderEdge): string {
  if (edge.style === null) return `<${tag}/>`

  const color = colorXml('color', edge.color)
  return color === ''
    ? `<${tag} style="${escaped(edge.style)}"/>`
    : `<${tag} style="${escaped(edge.style)}">${color}</${tag}>`
}

function borderXml(border: Border): string {
  return (
    '<border' +
    (border.diagonalUp ? ' diagonalUp="1"' : '') +
    (border.diagonalDown ? ' diagonalDown="1"' : '') +
    '>' +
    edgeXml('left', border.left) +
    edgeXml('right', border.right) +
    edgeXml('top', border.top) +
    edgeXml('bottom', border.bottom) +
    edgeXml('diagonal', border.diagonal) +
    '</border>'
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
  const nothing =
    changes.numberFormats.size === 0 &&
    changes.cellFormats.length === 0 &&
    changes.fonts.length === 0 &&
    changes.fills.length === 0 &&
    changes.borders.length === 0
  if (nothing) return xml

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

  // The three lists a cell format points into, before the formats themselves:
  // an entry that pointed at a font the part had not declared yet would be a
  // file Excel offers to repair.
  patched = appended(
    patched,
    'fonts',
    'font',
    changes.fonts.map((one) => fontXml(one)),
  )
  patched = appended(
    patched,
    'fills',
    'fill',
    changes.fills.map((one) => fillXml(one)),
  )
  patched = appended(
    patched,
    'borders',
    'border',
    changes.borders.map((one) => borderXml(one)),
  )

  patched = appended(
    patched,
    'cellXfs',
    'xf',
    changes.cellFormats.map((format) => cellFormatXml(format)),
  )

  return patched
}

/**
 * New children at the end of a list, with its count brought up to date.
 *
 * At the end and nowhere else: every one of these lists is indexed by
 * position, so an insertion anywhere earlier silently renumbers everything
 * after it — which is the same cell pointing at a different look.
 */
function appended(xml: string, container: string, tag: string, added: string[]): string {
  if (added.length === 0) return xml

  const existing = new RegExp(`<${container}(?:\\s[^>]*)?>([\\s\\S]*?)</${container}>`, 'u').exec(
    xml,
  )
  if (existing === null) return xml

  const inside = existing[1] ?? ''
  const count = (inside.match(new RegExp(`<${tag}\\b`, 'gu'))?.length ?? 0) + added.length

  return (
    xml.slice(0, existing.index) +
    `<${container} count="${String(count)}">${inside}${added.join('')}</${container}>` +
    xml.slice(existing.index + existing[0].length)
  )
}

/**
 * The lists a cell format points into, and how to find a place in them.
 *
 * The same shape three times over: compare what is wanted against what the
 * file already has, and append only where there is nothing to point at. The
 * comparison is by value and not by reference, because two fonts built from
 * the same toolbar click are two objects and one font.
 */
const sameColor = (a: StyleColor | null, b: StyleColor | null): boolean => {
  if (a === null || b === null) return a === b
  if (a.kind !== b.kind) return false

  if (a.kind === 'rgb') return a.hex === (b as { hex: string }).hex
  if (a.kind === 'theme') {
    const other = b as { index: number; tint: number }
    return a.index === other.index && a.tint === other.tint
  }
  if (a.kind === 'indexed') return a.index === (b as { index: number }).index

  return true
}

const sameFont = (a: Font, b: Font): boolean =>
  a.name === b.name &&
  a.size === b.size &&
  a.bold === b.bold &&
  a.italic === b.italic &&
  a.underline === b.underline &&
  a.strike === b.strike &&
  a.vertAlign === b.vertAlign &&
  a.scheme === b.scheme &&
  sameColor(a.color, b.color)

const sameFill = (a: Fill, b: Fill): boolean =>
  a.pattern === b.pattern &&
  a.gradient === b.gradient &&
  sameColor(a.foreground, b.foreground) &&
  sameColor(a.background, b.background)

const sameEdge = (a: BorderEdge, b: BorderEdge): boolean =>
  a.style === b.style && sameColor(a.color, b.color)

const sameBorder = (a: Border, b: Border): boolean =>
  a.diagonalUp === b.diagonalUp &&
  a.diagonalDown === b.diagonalDown &&
  sameEdge(a.left, b.left) &&
  sameEdge(a.right, b.right) &&
  sameEdge(a.top, b.top) &&
  sameEdge(a.bottom, b.bottom) &&
  sameEdge(a.diagonal, b.diagonal)

function indexIn<T>(list: T[], added: T[], wanted: T, same: (a: T, b: T) => boolean): number {
  const existing = list.findIndex((one) => same(one, wanted))
  if (existing !== -1) return existing

  list.push(wanted)
  added.push(wanted)
  return list.length - 1
}

export const fontIndex = (styles: Styles, changes: StyleChanges, font: Font): number =>
  indexIn(styles.fonts, changes.fonts, font, sameFont)

export const fillIndex = (styles: Styles, changes: StyleChanges, fill: Fill): number =>
  indexIn(styles.fills, changes.fills, fill, sameFill)

export const borderIndex = (styles: Styles, changes: StyleChanges, border: Border): number =>
  indexIn(styles.borders, changes.borders, border, sameBorder)

/** What a toolbar can change about a cell; anything left out is left alone. */
export interface LookChange {
  /** Merged over the font the cell has, so bolding does not resize it. */
  font?: Partial<Font>
  /** A solid fill, or null to take the fill away. */
  fill?: StyleColor | null
  /** The edges to set; the ones not named keep what they had. */
  border?: Partial<Border>
  alignment?: Partial<Alignment>
  numberFormat?: string
}

const BARE_FONT: Font = {
  name: null,
  size: null,
  bold: false,
  italic: false,
  underline: null,
  strike: false,
  color: null,
  vertAlign: null,
  scheme: null,
}

const NO_FILL: Fill = { pattern: 'none', foreground: null, background: null, gradient: false }

const BARE_ALIGNMENT: Alignment = {
  horizontal: null,
  vertical: null,
  wrapText: false,
  indent: 0,
  textRotation: null,
  shrinkToFit: false,
}

/**
 * A cell's style index, changed in the ways asked for and no others.
 *
 * Every part starts from what the cell already had, so bolding a red cell
 * leaves it red and a cell given a fill keeps its font. That is the whole
 * difference between a toolbar and a style picker, and it is why this takes
 * the index the cell points at rather than building from nothing.
 */
export function styleWith(
  styles: Styles,
  changes: StyleChanges,
  from: number | null,
  look: LookChange,
): number {
  const base = styles.cellFormats[from ?? 0] ?? EMPTY_FORMAT
  const wanted: CellFormat = { ...base, applies: { ...base.applies } }

  // What the cell actually looks like, which is not what its own entry says:
  // an entry that states no font of its own takes one from the named style
  // behind it, and bolding that cell has to start from the font it shows.
  const shown = resolveStyle(styles, from)

  if (look.font !== undefined) {
    wanted.font = fontIndex(styles, changes, { ...(shown.font ?? BARE_FONT), ...look.font })
    wanted.applies.font = true
  }

  if (look.fill !== undefined) {
    const fill: Fill =
      look.fill === null
        ? NO_FILL
        : { pattern: 'solid', foreground: look.fill, background: null, gradient: false }

    wanted.fill = fillIndex(styles, changes, fill)
    wanted.applies.fill = true
  }

  if (look.border !== undefined) {
    wanted.border = borderIndex(styles, changes, { ...shown.border, ...look.border })
    wanted.applies.border = true
  }

  if (look.alignment !== undefined) {
    wanted.alignment = { ...(shown.alignment ?? BARE_ALIGNMENT), ...look.alignment }
    wanted.applies.alignment = true
  }

  if (look.numberFormat !== undefined) {
    wanted.numberFormat = numberFormatId(styles, changes, look.numberFormat)
    wanted.applies.numberFormat = true
  }

  return cellFormatIndex(styles, changes, wanted)
}
