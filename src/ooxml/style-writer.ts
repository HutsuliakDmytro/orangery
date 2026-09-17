import { attribute, buildXml, children, element, parseXml, tagName, withDeclaration } from './xml'
import type { XmlNode } from './xml'
import { formatColor, multiplierToLineUnits, pointsToHalfPoints, pointsToTwips } from './units'
import type { StyleFormatting, StyleType } from './styles'

/**
 * Adding a style to `styles.xml`, or rewriting one that is already there.
 *
 * A style states formatting once so that every paragraph or run wearing it
 * changes together. Writing one means putting it where the file keeps its
 * styles — a style a document refers to but does not define renders as though
 * the text had no style at all.
 */

export interface StyleDefinition {
  id: string
  name: string
  type: StyleType
  /** The style this one starts from, or null to start from the defaults. */
  basedOn: string | null
  /** The style applied to the paragraph after this one. */
  next: string | null
  formatting: StyleFormatting
}

/** Run properties, in the order `w:rPr` requires. */
function runProperties(formatting: StyleFormatting): XmlNode | null {
  const properties: XmlNode[] = []

  if (formatting.bold === true) properties.push(element('w:b'))
  if (formatting.italic === true) properties.push(element('w:i'))
  if (formatting.strike === true) properties.push(element('w:strike'))
  if (formatting.underline === true) properties.push(element('w:u', { 'w:val': 'single' }))

  if (formatting.fontFamily !== undefined) {
    properties.push(
      element('w:rFonts', {
        'w:ascii': formatting.fontFamily,
        'w:hAnsi': formatting.fontFamily,
        'w:cs': formatting.fontFamily,
      }),
    )
  }

  if (formatting.color !== undefined) {
    properties.push(element('w:color', { 'w:val': formatColor(formatting.color) }))
  }

  if (formatting.fontSize !== undefined) {
    const halfPoints = String(pointsToHalfPoints(formatting.fontSize))
    properties.push(element('w:sz', { 'w:val': halfPoints }))
    properties.push(element('w:szCs', { 'w:val': halfPoints }))
  }

  return properties.length > 0 ? element('w:rPr', {}, properties) : null
}

/** Paragraph properties, in the order `w:pPr` requires. */
function paragraphProperties(formatting: StyleFormatting): XmlNode | null {
  const properties: XmlNode[] = []

  if (formatting.outlineLevel !== undefined) {
    properties.push(element('w:outlineLvl', { 'w:val': String(formatting.outlineLevel) }))
  }

  const spacing: Record<string, string> = {}
  if (formatting.spaceBefore !== undefined) {
    spacing['w:before'] = String(pointsToTwips(formatting.spaceBefore))
  }
  if (formatting.spaceAfter !== undefined) {
    spacing['w:after'] = String(pointsToTwips(formatting.spaceAfter))
  }
  if (formatting.lineHeight !== undefined) {
    spacing['w:line'] = String(multiplierToLineUnits(formatting.lineHeight))
    spacing['w:lineRule'] = 'auto'
  }
  if (Object.keys(spacing).length > 0) properties.push(element('w:spacing', spacing))

  const indent: Record<string, string> = {}
  if (formatting.indentLeft !== undefined) {
    indent['w:left'] = String(pointsToTwips(formatting.indentLeft))
  }
  if (formatting.indentFirstLine !== undefined) {
    // A negative first line is a hanging indent, which OOXML states separately.
    const value = pointsToTwips(Math.abs(formatting.indentFirstLine))
    indent[formatting.indentFirstLine < 0 ? 'w:hanging' : 'w:firstLine'] = String(value)
  }
  if (Object.keys(indent).length > 0) properties.push(element('w:ind', indent))

  if (formatting.textAlign !== undefined) {
    // OOXML calls it `both`; the editor and CSS call it `justify`.
    const value = formatting.textAlign === 'justify' ? 'both' : formatting.textAlign
    properties.push(element('w:jc', { 'w:val': value }))
  }

  return properties.length > 0 ? element('w:pPr', {}, properties) : null
}

export function buildStyle(definition: StyleDefinition): XmlNode {
  const paragraph =
    definition.type === 'paragraph' ? paragraphProperties(definition.formatting) : null
  const run = runProperties(definition.formatting)

  return element('w:style', { 'w:type': definition.type, 'w:styleId': definition.id }, [
    element('w:name', { 'w:val': definition.name }),
    ...(definition.basedOn === null ? [] : [element('w:basedOn', { 'w:val': definition.basedOn })]),
    ...(definition.next === null ? [] : [element('w:next', { 'w:val': definition.next })]),
    // `w:qFormat` is what puts a style in Word's own gallery; without it a
    // style the user just made is one they cannot find again.
    element('w:qFormat'),
    ...(paragraph ? [paragraph] : []),
    ...(run ? [run] : []),
  ])
}

/**
 * Puts the style into `styles.xml`, replacing one with the same id.
 *
 * Replacing rather than adding: two styles sharing an id is a file Word
 * repairs, and rewriting is what "update to match the selection" means.
 */
export function upsertStyle(stylesXml: string, definition: StyleDefinition): string {
  const roots = parseXml(stylesXml)
  const root = roots.find((node) => tagName(node) === 'w:styles')
  if (!root) return stylesXml

  const list: unknown = root['w:styles']
  if (!Array.isArray(list)) return stylesXml

  const styles = list as XmlNode[]
  const built = buildStyle(definition)

  const existing = styles.findIndex(
    (node) => tagName(node) === 'w:style' && attribute(node, 'w:styleId') === definition.id,
  )

  if (existing === -1) styles.push(built)
  else styles.splice(existing, 1, built)

  return withDeclaration(buildXml(roots))
}

/** An id that no style in the file is using yet. */
export function freeStyleId(stylesXml: string, name: string): string {
  const taken = new Set(
    parseXml(stylesXml)
      .flatMap((node) => (tagName(node) === 'w:styles' ? children(node) : []))
      .filter((node) => tagName(node) === 'w:style')
      .map((node) => attribute(node, 'w:styleId')),
  )

  // Word ids carry no spaces or punctuation; the display name keeps those.
  const base = name.replace(/[^\p{L}\p{N}]/gu, '') || 'Style'
  if (!taken.has(base)) return base

  let index = 1
  while (taken.has(`${base}${String(index)}`)) index += 1
  return `${base}${String(index)}`
}
