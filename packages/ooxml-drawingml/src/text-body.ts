import { attribute, children, findChild, tagName, textValue } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { readColorChild } from './color'
import type { Color } from './color'

/**
 * `a:txBody` — text inside a shape.
 *
 * The same model WordprocessingML describes with `w:p` and `w:r`: paragraphs of
 * runs, each carrying properties. The tag names differ and almost nothing else
 * does, which is why the editor side is shared (`@orangery/editor-text`).
 *
 * What is genuinely different is that a deck's text inherits down nine levels.
 * A paragraph states its level and very little else; the rest comes from the
 * shape's own `a:lstStyle`, then the layout placeholder's, then the master's,
 * then the theme's default text style. This file reads each of those; resolving
 * across them is `list-style.ts`.
 */

/** Hundredths of a point, as `sz` and `a:spcPts` are written. */
const hundredthsOfPoint = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed / 100 : null
}

const thousandthsOfPercent = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed / 100000 : null
}

const emu = (value: string | undefined): number | null => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const toggle = (value: string | undefined): boolean | null =>
  value === undefined ? null : value === '1' || value === 'true'

// --- runs -------------------------------------------------------------------

export interface RunProperties {
  /** Points. */
  size: number | null
  bold: boolean | null
  italic: boolean | null
  /** `a:u` — `none`, `sng`, `dbl`, … */
  underline: string | null
  strike: string | null
  color: Color | null
  /**
   * `a:latin` typeface. May be a theme reference — `+mn-lt`, `+mj-lt` — which
   * is left as written and resolved against the theme when drawing.
   */
  font: string | null
  /** Character spacing in points. */
  spacing: number | null
  /** `a:rPr cap` — `none`, `small`, `all`. */
  caps: string | null
  /** `baseline` as a fraction: 0.3 is superscript, -0.25 subscript. */
  baseline: number | null
  /** Relationship id of a hyperlink on the run. */
  hyperlink: string | null
}

const EMPTY_RUN_PROPERTIES: RunProperties = {
  size: null,
  bold: null,
  italic: null,
  underline: null,
  strike: null,
  color: null,
  font: null,
  spacing: null,
  caps: null,
  baseline: null,
  hyperlink: null,
}

export function readRunProperties(element: XmlNode): RunProperties {
  const fill = findChild(element, 'a:solidFill')
  const latin = findChild(element, 'a:latin')
  const link = findChild(element, 'a:hlinkClick')

  return {
    size: hundredthsOfPoint(attribute(element, 'sz')),
    bold: toggle(attribute(element, 'b')),
    italic: toggle(attribute(element, 'i')),
    underline: attribute(element, 'u') ?? null,
    strike: attribute(element, 'strike') ?? null,
    color: fill === undefined ? null : readColorChild(fill),
    font: latin === undefined ? null : (attribute(latin, 'typeface') ?? null),
    spacing: hundredthsOfPoint(attribute(element, 'spc')),
    caps: attribute(element, 'cap') ?? null,
    baseline: thousandthsOfPercent(attribute(element, 'baseline')),
    hyperlink: link === undefined ? null : (attribute(link, 'r:id') ?? null),
  }
}

export interface TextRun {
  /** `text` for `a:r`, `break` for `a:br`, `field` for `a:fld`. */
  kind: 'text' | 'break' | 'field'
  text: string
  properties: RunProperties | null
  /** For a field: `slidenum`, `datetime1`, … What PowerPoint substitutes. */
  fieldType: string | null
}

function readRun(node: XmlNode): TextRun | null {
  const tag = tagName(node)
  const properties = findChild(node, 'a:rPr')
  const read = properties === undefined ? null : readRunProperties(properties)

  switch (tag) {
    case 'a:r': {
      const text = findChild(node, 'a:t')
      return {
        kind: 'text',
        // An `a:t` holding only whitespace is meaningful text, not an empty run.
        text: text === undefined ? '' : textOf(text),
        properties: read,
        fieldType: null,
      }
    }
    case 'a:br':
      return { kind: 'break', text: '\n', properties: read, fieldType: null }
    case 'a:fld': {
      const text = findChild(node, 'a:t')
      return {
        kind: 'field',
        // The cached result, which is what to show until the field is evaluated.
        text: text === undefined ? '' : textOf(text),
        properties: read,
        fieldType: attribute(node, 'type') ?? null,
      }
    }
    default:
      return null
  }
}

/** `a:t` holds its text as a child node; an empty element means an empty string. */
function textOf(element: XmlNode): string {
  return children(element)
    .map((child) => textValue(child))
    .join('')
}

// --- bullets ----------------------------------------------------------------

export type Bullet =
  | { kind: 'none' }
  | { kind: 'character'; character: string; font: string | null }
  | { kind: 'autoNumber'; scheme: string; startAt: number | null }
  | { kind: 'picture'; relationshipId: string | null }

function readBullet(properties: XmlNode): Bullet | null {
  for (const child of children(properties)) {
    const tag = tagName(child)

    if (tag === 'a:buNone') return { kind: 'none' }

    if (tag === 'a:buChar') {
      const font = findChild(properties, 'a:buFont')
      return {
        kind: 'character',
        character: attribute(child, 'char') ?? '•',
        font: font === undefined ? null : (attribute(font, 'typeface') ?? null),
      }
    }

    if (tag === 'a:buAutoNum') {
      const startAt = Number(attribute(child, 'startAt'))
      return {
        kind: 'autoNumber',
        scheme: attribute(child, 'type') ?? 'arabicPeriod',
        startAt: Number.isFinite(startAt) ? startAt : null,
      }
    }

    if (tag === 'a:buBlip') {
      const blip = findChild(child, 'a:blip')
      return {
        kind: 'picture',
        relationshipId: (blip === undefined ? undefined : attribute(blip, 'r:embed')) ?? null,
      }
    }
  }

  return null
}

// --- paragraphs -------------------------------------------------------------

/** Line and gap spacing: either a multiple of the line, or an absolute size. */
export type Spacing = { kind: 'percent'; value: number } | { kind: 'points'; value: number }

function readSpacing(parent: XmlNode, tag: string): Spacing | null {
  const element = findChild(parent, tag)
  if (element === undefined) return null

  const percent = findChild(element, 'a:spcPct')
  if (percent !== undefined) {
    const value = thousandthsOfPercent(attribute(percent, 'val'))
    return value === null ? null : { kind: 'percent', value }
  }

  const points = findChild(element, 'a:spcPts')
  if (points !== undefined) {
    const value = hundredthsOfPoint(attribute(points, 'val'))
    return value === null ? null : { kind: 'points', value }
  }

  return null
}

export interface ParagraphProperties {
  /** 0 to 8. A deck's outline depth, which is what everything inherits along. */
  level: number
  /** `l`, `ctr`, `r`, `just`, `dist`. */
  align: string | null
  /** Left margin in EMU. */
  marginLeft: number | null
  /** First-line indent in EMU; negative for a hanging indent. */
  indent: number | null
  bullet: Bullet | null
  lineSpacing: Spacing | null
  spaceBefore: Spacing | null
  spaceAfter: Spacing | null
  /** `a:defRPr` — what runs in this paragraph default to. */
  defaultRunProperties: RunProperties | null
}

const EMPTY_PARAGRAPH_PROPERTIES: ParagraphProperties = {
  level: 0,
  align: null,
  marginLeft: null,
  indent: null,
  bullet: null,
  lineSpacing: null,
  spaceBefore: null,
  spaceAfter: null,
  defaultRunProperties: null,
}

export function readParagraphProperties(element: XmlNode): ParagraphProperties {
  const level = Number(attribute(element, 'lvl'))
  const defaults = findChild(element, 'a:defRPr')

  return {
    level: Number.isFinite(level) ? level : 0,
    align: attribute(element, 'algn') ?? null,
    marginLeft: emu(attribute(element, 'marL')),
    indent: emu(attribute(element, 'indent')),
    bullet: readBullet(element),
    lineSpacing: readSpacing(element, 'a:lnSpc'),
    spaceBefore: readSpacing(element, 'a:spcBef'),
    spaceAfter: readSpacing(element, 'a:spcAft'),
    defaultRunProperties: defaults === undefined ? null : readRunProperties(defaults),
  }
}

export interface TextParagraph {
  properties: ParagraphProperties
  runs: TextRun[]
  /**
   * `a:endParaRPr` — the properties text would take if typed at the end.
   *
   * The only thing an empty paragraph carries, and dropping it loses the
   * formatting of every blank line in a deck.
   */
  endProperties: RunProperties | null
  node: XmlNode
}

export function readParagraph(node: XmlNode): TextParagraph {
  const properties = findChild(node, 'a:pPr')
  const end = findChild(node, 'a:endParaRPr')

  return {
    properties:
      properties === undefined ? EMPTY_PARAGRAPH_PROPERTIES : readParagraphProperties(properties),
    runs: children(node).flatMap((child) => {
      const run = readRun(child)
      return run === null ? [] : [run]
    }),
    endProperties: end === undefined ? null : readRunProperties(end),
    node,
  }
}

// --- the body ---------------------------------------------------------------

export interface Autofit {
  /** `none` leaves text overflowing, `normal` shrinks it, `shape` grows the box. */
  kind: 'none' | 'normal' | 'shape'
  /** What `normal` has already shrunk the text to, as a fraction. */
  fontScale: number | null
  lineSpaceReduction: number | null
}

export interface BodyProperties {
  /** Padding in EMU. Null means the shape does not state it and takes the default. */
  insets: { left: number | null; top: number | null; right: number | null; bottom: number | null }
  /** `t`, `ctr`, `b` — where the text sits vertically in the box. */
  anchor: string | null
  anchorCentered: boolean | null
  /** `square` wraps at the box edge, `none` lets a line run past it. */
  wrap: string | null
  autofit: Autofit | null
  columns: { count: number; spacing: number | null } | null
  /** 60000ths of a degree. */
  rotation: number | null
  /** `horz`, `vert`, `vert270`, `eaVert`, … */
  vertical: string | null
}

export function readBodyProperties(element: XmlNode): BodyProperties {
  const columns = Number(attribute(element, 'numCol'))

  const autofit = ((): Autofit | null => {
    if (findChild(element, 'a:noAutofit') !== undefined) {
      return { kind: 'none', fontScale: null, lineSpaceReduction: null }
    }
    if (findChild(element, 'a:spAutoFit') !== undefined) {
      return { kind: 'shape', fontScale: null, lineSpaceReduction: null }
    }
    const normal = findChild(element, 'a:normAutofit')
    if (normal === undefined) return null

    // PowerPoint records what it has already shrunk the text to, and reads its
    // own values back. Recomputing without them would resize text on open.
    return {
      kind: 'normal',
      fontScale: thousandthsOfPercent(attribute(normal, 'fontScale')),
      lineSpaceReduction: thousandthsOfPercent(attribute(normal, 'lnSpcReduction')),
    }
  })()

  return {
    insets: {
      left: emu(attribute(element, 'lIns')),
      top: emu(attribute(element, 'tIns')),
      right: emu(attribute(element, 'rIns')),
      bottom: emu(attribute(element, 'bIns')),
    },
    anchor: attribute(element, 'anchor') ?? null,
    anchorCentered: toggle(attribute(element, 'anchorCtr')),
    wrap: attribute(element, 'wrap') ?? null,
    autofit,
    columns: Number.isFinite(columns)
      ? { count: columns, spacing: emu(attribute(element, 'spcCol')) }
      : null,
    rotation: emu(attribute(element, 'rot')),
    vertical: attribute(element, 'vert') ?? null,
  }
}

/** `a:lstStyle` — the nine levels of defaults a body states for its own text. */
export type ListStyle = Map<number, ParagraphProperties>

export function readListStyle(element: XmlNode): ListStyle {
  const levels = new Map<number, ParagraphProperties>()

  for (const child of children(element)) {
    const match = /^a:lvl([1-9])pPr$/u.exec(tagName(child) ?? '')
    if (match?.[1] === undefined) continue
    // Written one-based and used zero-based, which is a reliable off-by-one.
    levels.set(Number(match[1]) - 1, readParagraphProperties(child))
  }

  return levels
}

export interface TextBody {
  bodyProperties: BodyProperties | null
  listStyle: ListStyle
  paragraphs: TextParagraph[]
  node: XmlNode
}

/** Reads `a:txBody` / `p:txBody`. */
export function readTextBody(node: XmlNode): TextBody {
  const body = findChild(node, 'a:bodyPr')
  const list = findChild(node, 'a:lstStyle')

  return {
    bodyProperties: body === undefined ? null : readBodyProperties(body),
    listStyle: list === undefined ? new Map<number, ParagraphProperties>() : readListStyle(list),
    paragraphs: children(node)
      .filter((child) => tagName(child) === 'a:p')
      .map(readParagraph),
    node,
  }
}

/** The plain text of a body, paragraphs separated by newlines. */
export function textOfBody(body: TextBody): string {
  return body.paragraphs
    .map((paragraph) => paragraph.runs.map((run) => run.text).join(''))
    .join('\n')
}

export { EMPTY_RUN_PROPERTIES, EMPTY_PARAGRAPH_PROPERTIES }
