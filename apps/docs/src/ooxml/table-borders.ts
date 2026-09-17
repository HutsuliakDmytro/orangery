import { attribute, children, element, findChild, parseXml, serializeNode, tagName } from './xml'
import type { XmlNode } from './xml'
import { formatColor, parseColor, parseIntAttribute } from './units'

/**
 * Table borders — `w:tblBorders` and `w:tcBorders`.
 *
 * Word measures border width in eighths of a point, which is why a "half point"
 * line is `w:sz="4"`. The set of line styles is long; these are the ones a user
 * picks from a toolbar, and any other value is preserved rather than rewritten.
 */

export const BORDER_STYLES = [
  { value: 'none', label: 'None' },
  { value: 'single', label: 'Single' },
  { value: 'double', label: 'Double' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
  { value: 'thick', label: 'Thick' },
] as const

export type BorderStyle = (typeof BORDER_STYLES)[number]['value']

/** The edges a table border set can describe, in the order OOXML requires. */
export const BORDER_EDGES = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'] as const

export type BorderEdge = (typeof BORDER_EDGES)[number]

export interface Border {
  /** A value from `BORDER_STYLES`, or any other `w:val` the source used. */
  style: string
  /** Width in points. Word stores eighths. */
  width: number
  color: string | null
}

export type BorderSet = Partial<Record<BorderEdge, Border>>

const EIGHTHS_PER_POINT = 8

export function eighthsToPoints(eighths: number): number {
  return Math.round((eighths / EIGHTHS_PER_POINT) * 100) / 100
}

export function pointsToEighths(points: number): number {
  return Math.max(0, Math.round(points * EIGHTHS_PER_POINT))
}

export function parseBorders(bordersNode: XmlNode | undefined): BorderSet {
  if (!bordersNode) return {}

  const borders: BorderSet = {}

  for (const child of children(bordersNode)) {
    const tag = tagName(child)?.replace(/^w:/u, '')
    if (tag === undefined || !(BORDER_EDGES as readonly string[]).includes(tag)) continue

    const size = parseIntAttribute(attribute(child, 'w:sz'))

    borders[tag as BorderEdge] = {
      style: attribute(child, 'w:val') ?? 'single',
      width: size === null ? 0.5 : eighthsToPoints(size),
      color: parseColor(attribute(child, 'w:color')),
    }
  }

  return borders
}

export function serializeBorders(borders: BorderSet, tag = 'w:tblBorders'): XmlNode | null {
  const edges = BORDER_EDGES.filter((edge) => borders[edge] !== undefined)
  if (edges.length === 0) return null

  return element(
    tag,
    {},
    edges.map((edge) => {
      const border = borders[edge]
      if (!border) return element(`w:${edge}`)
      return element(`w:${edge}`, {
        'w:val': border.style,
        // `none` still carries a size in Word's own output, so it is written.
        'w:sz': String(pointsToEighths(border.width)),
        'w:space': '0',
        'w:color': border.color === null ? 'auto' : formatColor(border.color),
      })
    }),
  )
}

/** Applies the same border to every edge, which is what a toolbar picker does. */
export function uniformBorders(border: Border): BorderSet {
  const borders: BorderSet = {}
  for (const edge of BORDER_EDGES) borders[edge] = border
  return borders
}

/**
 * Replaces the borders inside a preserved `w:tblPr`, leaving everything else —
 * table style, width, layout, look — exactly as it was.
 */
export function withBorders(tblPrXml: string | null, borders: BorderSet): string {
  const borderNode = serializeBorders(borders)

  if (tblPrXml === null) {
    return borderNode === null ? '' : serializeNode(element('w:tblPr', {}, [borderNode]))
  }

  const parsed = parseXml(tblPrXml)
  const tblPr = parsed.find((node) => tagName(node) === 'w:tblPr')
  if (!tblPr) return tblPrXml

  const existing = children(tblPr).filter((child) => tagName(child) !== 'w:tblBorders')

  // OOXML fixes the order of `w:tblPr` children: borders come after style,
  // position, width and indent, and before shading and layout.
  const before: XmlNode[] = []
  const after: XmlNode[] = []
  const BEFORE_BORDERS = new Set([
    'w:tblStyle',
    'w:tblpPr',
    'w:tblOverlap',
    'w:bidiVisual',
    'w:tblStyleRowBandSize',
    'w:tblStyleColBandSize',
    'w:tblW',
    'w:jc',
    'w:tblCellSpacing',
    'w:tblInd',
  ])

  for (const child of existing) {
    const tag = tagName(child)
    if (tag !== null && BEFORE_BORDERS.has(tag)) before.push(child)
    else after.push(child)
  }

  return serializeNode(
    element('w:tblPr', {}, [...before, ...(borderNode ? [borderNode] : []), ...after]),
  )
}

/** Reads the border set out of a preserved `w:tblPr`. */
export function bordersFrom(tblPrXml: string | null): BorderSet {
  if (tblPrXml === null) return {}

  const tblPr = parseXml(tblPrXml).find((node) => tagName(node) === 'w:tblPr')
  if (!tblPr) return {}

  return parseBorders(findChild(tblPr, 'w:tblBorders'))
}

/** CSS for rendering a border in the editor. */
export function borderToCss(border: Border | undefined): string {
  if (!border || border.style === 'none') return 'none'

  const style =
    border.style === 'double'
      ? 'double'
      : border.style === 'dashed'
        ? 'dashed'
        : border.style === 'dotted'
          ? 'dotted'
          : 'solid'

  const width = border.style === 'thick' ? Math.max(border.width, 1.5) : border.width
  return `${String(width)}pt ${style} ${border.color ?? '#000000'}`
}
