import { attribute, children, findChild, parseXml, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * `styles.xml` — what every cell looks like, said once and pointed at.
 *
 * A sheet does not carry its formatting: a cell states an index into
 * `cellXfs`, and that entry points at a font, a fill, a border and a number
 * format. The same five indexes serve a million cells, which is why a
 * spreadsheet stays small and why a writer that gave each cell its own `xf`
 * would make a file every other reader opens slowly.
 *
 * Colours stay symbolic. A theme colour resolves against the workbook's theme
 * when it is drawn and never when it is saved, so changing the theme recolours
 * the sheet the way Excel does instead of baking today's palette into the
 * file — the same rule charts follow.
 */

export type StyleColor =
  | { kind: 'rgb'; hex: string }
  /** Into the theme's `a:clrScheme`, with a lightening or darkening applied. */
  | { kind: 'theme'; index: number; tint: number }
  /** Into the legacy palette, which Excel still writes for older formats. */
  | { kind: 'indexed'; index: number }
  /** The reader's own idea of a foreground or background. */
  | { kind: 'auto' }

export interface Font {
  name: string | null
  /** In points. */
  size: number | null
  bold: boolean
  italic: boolean
  /** `single`, `double`, `singleAccounting`, `doubleAccounting`. */
  underline: string | null
  strike: boolean
  color: StyleColor | null
  /** `superscript` or `subscript`. */
  vertAlign: string | null
  /** `minor` or `major` — which theme font the name came from. */
  scheme: string | null
}

export interface Fill {
  /** `none`, `solid`, `gray125`, and the two dozen hatches nobody uses. */
  pattern: string | null
  foreground: StyleColor | null
  background: StyleColor | null
  /** A gradient is kept as it was read; nothing here draws one yet. */
  gradient: boolean
}

export interface BorderEdge {
  /** `thin`, `medium`, `dashed`, `double`… or null for no line. */
  style: string | null
  color: StyleColor | null
}

export interface Border {
  left: BorderEdge
  right: BorderEdge
  top: BorderEdge
  bottom: BorderEdge
  diagonal: BorderEdge
  diagonalUp: boolean
  diagonalDown: boolean
}

export interface Alignment {
  /** `general`, `left`, `center`, `right`, `fill`, `justify`, `centerContinuous`. */
  horizontal: string | null
  /** `top`, `center`, `bottom`, `justify`, `distributed`. */
  vertical: string | null
  wrapText: boolean
  /** In characters, each about three spaces wide. */
  indent: number
  /** Degrees anticlockwise; 255 is Excel's word for stacked letters. */
  textRotation: number | null
  shrinkToFit: boolean
}

/**
 * One entry of `cellXfs`, as written.
 *
 * The `apply*` flags are how an entry says which of its own indexes to use and
 * which to take from the named style behind it. A reader that ignored them
 * gives every cell the first font in the file.
 */
export interface CellFormat {
  numberFormat: number
  font: number
  fill: number
  border: number
  /** Into `cellStyleXfs`: the named style this cell's format is based on. */
  basedOn: number | null
  alignment: Alignment | null
  applies: {
    numberFormat: boolean
    font: boolean
    fill: boolean
    border: boolean
    alignment: boolean
  }
  /** `1` on a locked cell, which matters only once the sheet is protected. */
  locked: boolean
  hidden: boolean
}

export interface Styles {
  /** Custom format codes by id; the built-in ones are not in the file. */
  numberFormats: Map<number, string>
  fonts: Font[]
  fills: Fill[]
  borders: Border[]
  /** What a cell points at. */
  cellFormats: CellFormat[]
  /** What a named style points at, which a cell format can be based on. */
  styleFormats: CellFormat[]
  /** The formats conditional formatting applies on top of a cell's own. */
  differential: DifferentialFormat[]
}

/** A format stated in parts: only what it changes, laid over what is there. */
export interface DifferentialFormat {
  font: Font | null
  fill: Fill | null
  border: Border | null
  numberFormat: string | null
}

const EMPTY_EDGE: BorderEdge = { style: null, color: null }

const NO_BORDER: Border = {
  left: EMPTY_EDGE,
  right: EMPTY_EDGE,
  top: EMPTY_EDGE,
  bottom: EMPTY_EDGE,
  diagonal: EMPTY_EDGE,
  diagonalUp: false,
  diagonalDown: false,
}

const number = (
  node: XmlNode | undefined,
  name: string,
  fallback: number | null,
): number | null => {
  const value = Number(attribute(node ?? {}, name))
  return Number.isFinite(value) ? value : fallback
}

const flag = (node: XmlNode | undefined, name: string): boolean => {
  const value = attribute(node ?? {}, name)
  return value === '1' || value === 'true'
}

/**
 * A child element that is present unless it says otherwise.
 *
 * `<b/>` is bold, `<b val="0"/>` is not, and the absence of both is not
 * either. Getting this backwards makes every font in the file bold.
 */
const stated = (parent: XmlNode, tag: string): boolean => {
  const child = findChild(parent, tag)
  if (child === undefined) return false

  const value = attribute(child, 'val')
  return value === undefined || value === '1' || value === 'true'
}

function readColor(node: XmlNode | undefined): StyleColor | null {
  if (node === undefined) return null

  const rgb = attribute(node, 'rgb')
  if (rgb !== undefined) return { kind: 'rgb', hex: rgb }

  const theme = number(node, 'theme', null)
  if (theme !== null) return { kind: 'theme', index: theme, tint: number(node, 'tint', 0) ?? 0 }

  const indexed = number(node, 'indexed', null)
  if (indexed !== null) return { kind: 'indexed', index: indexed }

  return flag(node, 'auto') ? { kind: 'auto' } : null
}

function readFont(node: XmlNode): Font {
  const named = findChild(node, 'name') ?? findChild(node, 'rFont')
  const underline = findChild(node, 'u')

  return {
    name: attribute(named ?? {}, 'val') ?? null,
    size: number(findChild(node, 'sz'), 'val', null),
    bold: stated(node, 'b'),
    italic: stated(node, 'i'),
    underline: underline === undefined ? null : (attribute(underline, 'val') ?? 'single'),
    strike: stated(node, 'strike'),
    color: readColor(findChild(node, 'color')),
    vertAlign: attribute(findChild(node, 'vertAlign') ?? {}, 'val') ?? null,
    scheme: attribute(findChild(node, 'scheme') ?? {}, 'val') ?? null,
  }
}

function readFill(node: XmlNode): Fill {
  const pattern = findChild(node, 'patternFill')
  if (pattern === undefined) {
    return {
      pattern: null,
      foreground: null,
      background: null,
      gradient: findChild(node, 'gradientFill') !== undefined,
    }
  }

  return {
    pattern: attribute(pattern, 'patternType') ?? null,
    foreground: readColor(findChild(pattern, 'fgColor')),
    background: readColor(findChild(pattern, 'bgColor')),
    gradient: false,
  }
}

const readEdge = (parent: XmlNode, name: string): BorderEdge => {
  const edge = findChild(parent, name)
  if (edge === undefined) return EMPTY_EDGE

  return { style: attribute(edge, 'style') ?? null, color: readColor(findChild(edge, 'color')) }
}

function readBorder(node: XmlNode): Border {
  return {
    left: readEdge(node, 'left'),
    right: readEdge(node, 'right'),
    top: readEdge(node, 'top'),
    bottom: readEdge(node, 'bottom'),
    diagonal: readEdge(node, 'diagonal'),
    diagonalUp: flag(node, 'diagonalUp'),
    diagonalDown: flag(node, 'diagonalDown'),
  }
}

function readAlignment(node: XmlNode): Alignment | null {
  const alignment = findChild(node, 'alignment')
  if (alignment === undefined) return null

  return {
    horizontal: attribute(alignment, 'horizontal') ?? null,
    vertical: attribute(alignment, 'vertical') ?? null,
    wrapText: flag(alignment, 'wrapText'),
    indent: number(alignment, 'indent', 0) ?? 0,
    textRotation: number(alignment, 'textRotation', null),
    shrinkToFit: flag(alignment, 'shrinkToFit'),
  }
}

function readFormat(node: XmlNode): CellFormat {
  const protection = findChild(node, 'protection')

  return {
    numberFormat: number(node, 'numFmtId', 0) ?? 0,
    font: number(node, 'fontId', 0) ?? 0,
    fill: number(node, 'fillId', 0) ?? 0,
    border: number(node, 'borderId', 0) ?? 0,
    basedOn: number(node, 'xfId', null),
    alignment: readAlignment(node),
    applies: {
      numberFormat: flag(node, 'applyNumberFormat'),
      font: flag(node, 'applyFont'),
      fill: flag(node, 'applyFill'),
      border: flag(node, 'applyBorder'),
      alignment: flag(node, 'applyAlignment'),
    },
    locked: protection === undefined ? true : flag(protection, 'locked'),
    hidden: protection === undefined ? false : flag(protection, 'hidden'),
  }
}

const listOf = <T>(
  root: XmlNode,
  container: string,
  tag: string,
  read: (node: XmlNode) => T,
): T[] => {
  const parent = findChild(root, container)
  if (parent === undefined) return []

  return children(parent)
    .filter((child) => tagName(child) === tag)
    .map((child) => read(child))
}

function readDifferential(node: XmlNode): DifferentialFormat {
  const font = findChild(node, 'font')
  const fill = findChild(node, 'fill')
  const border = findChild(node, 'border')
  const format = findChild(node, 'numFmt')

  return {
    font: font === undefined ? null : readFont(font),
    fill: fill === undefined ? null : readFill(fill),
    border: border === undefined ? null : readBorder(border),
    numberFormat: attribute(format ?? {}, 'formatCode') ?? null,
  }
}

export function readStyles(xml: string): Styles | null {
  const root = parseXml(xml).find((node) => tagName(node) === 'styleSheet')
  if (root === undefined) return null

  const formats = findChild(root, 'numFmts')

  return {
    numberFormats: new Map(
      formats === undefined
        ? []
        : children(formats).flatMap((entry) => {
            const id = number(entry, 'numFmtId', null)
            const code = attribute(entry, 'formatCode')
            return id === null || code === undefined ? [] : [[id, code] as const]
          }),
    ),
    fonts: listOf(root, 'fonts', 'font', readFont),
    fills: listOf(root, 'fills', 'fill', readFill),
    borders: listOf(root, 'borders', 'border', readBorder),
    cellFormats: listOf(root, 'cellXfs', 'xf', readFormat),
    styleFormats: listOf(root, 'cellStyleXfs', 'xf', readFormat),
    differential: listOf(root, 'dxfs', 'dxf', readDifferential),
  }
}

/** What a cell actually looks like, after the indexes have been followed. */
export interface ResolvedStyle {
  numberFormat: number
  font: Font | null
  fill: Fill | null
  border: Border
  alignment: Alignment | null
  locked: boolean
}

/**
 * The style a cell's index stands for.
 *
 * Two levels: the entry in `cellXfs`, and behind it the named style it is
 * based on. Each `apply*` flag says which level wins for that one thing — a
 * cell that is Normal except for being bold states its own font and takes
 * everything else from the style, and a reader that ignored the flags would
 * give it the first font in the file.
 *
 * Cached by the caller: a grid asks this for every visible cell on every
 * repaint, and the answer only changes when the styles do.
 */
export function resolveStyle(styles: Styles, index: number | null): ResolvedStyle {
  const format = styles.cellFormats[index ?? 0]
  if (format === undefined) {
    return {
      numberFormat: 0,
      font: styles.fonts[0] ?? null,
      fill: null,
      border: NO_BORDER,
      alignment: null,
      locked: true,
    }
  }

  const base = format.basedOn === null ? undefined : styles.styleFormats[format.basedOn]
  const pick = (own: boolean, mine: number, theirs: number | undefined): number =>
    own || theirs === undefined ? mine : theirs

  return {
    numberFormat: pick(format.applies.numberFormat, format.numberFormat, base?.numberFormat),
    font: styles.fonts[pick(format.applies.font, format.font, base?.font)] ?? null,
    fill: styles.fills[pick(format.applies.fill, format.fill, base?.fill)] ?? null,
    border: styles.borders[pick(format.applies.border, format.border, base?.border)] ?? NO_BORDER,
    // A cell that states its own alignment keeps it; one that does not takes
    // the named style's, which is how a heading style centres its cells.
    alignment: format.applies.alignment ? format.alignment : (base?.alignment ?? format.alignment),
    locked: format.locked,
  }
}

/** The format code a cell's style asks for, built-in ones included. */
export function formatCodeOf(styles: Styles, numberFormat: number): string | null {
  return styles.numberFormats.get(numberFormat) ?? BUILT_IN.get(numberFormat) ?? null
}

/**
 * The formats every reader is born knowing.
 *
 * Ids 0 to 49 are not in the file — Excel assumes them — and a reader without
 * them shows a date as 45292 and a percentage as 0.15. The gaps in the
 * numbering are Excel's own; ids 23 to 36 are reserved and locale-dependent.
 */
const BUILT_IN = new Map<number, string>([
  [0, 'General'],
  [1, '0'],
  [2, '0.00'],
  [3, '#,##0'],
  [4, '#,##0.00'],
  [9, '0%'],
  [10, '0.00%'],
  [11, '0.00E+00'],
  [12, '# ?/?'],
  [13, '# ??/??'],
  [14, 'mm-dd-yy'],
  [15, 'd-mmm-yy'],
  [16, 'd-mmm'],
  [17, 'mmm-yy'],
  [18, 'h:mm AM/PM'],
  [19, 'h:mm:ss AM/PM'],
  [20, 'h:mm'],
  [21, 'h:mm:ss'],
  [22, 'm/d/yy h:mm'],
  [37, '#,##0 ;(#,##0)'],
  [38, '#,##0 ;[Red](#,##0)'],
  [39, '#,##0.00;(#,##0.00)'],
  [40, '#,##0.00;[Red](#,##0.00)'],
  [45, 'mm:ss'],
  [46, '[h]:mm:ss'],
  [47, 'mmss.0'],
  [48, '##0.0E+0'],
  [49, '@'],
])

/** Whether a format code shows a date, which decides how a number is read. */
export const isDateFormat = (code: string | null): boolean =>
  code !== null &&
  /(?:\[[^\]]*\]|"[^"]*")|([ymdhs])/iu.test(code.replace(/\[[^\]]*\]|"[^"]*"/gu, ''))
