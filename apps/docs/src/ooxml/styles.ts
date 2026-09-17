import {
  attribute,
  children,
  findChild,
  halfPointsToPoints,
  lineUnitsToMultiplier,
  parseColor,
  parseIntAttribute,
  parseToggle,
  parseXml,
  tagName,
  twipsToPoints,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * `word/styles.xml` → a resolved style catalogue.
 *
 * Styles form an inheritance chain through `w:basedOn`, and a paragraph only
 * names the leaf. Rendering a document correctly means resolving that chain,
 * otherwise a Heading 2 that inherits its font from Heading 1 loses it. The
 * catalogue is read-only: `styles.xml` is written back untouched.
 */

export type StyleType = 'paragraph' | 'character' | 'table' | 'numbering'

export interface StyleFormatting {
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strike?: boolean
  fontFamily?: string
  fontSize?: number
  color?: string
  textAlign?: string
  lineHeight?: number
  spaceBefore?: number
  spaceAfter?: number
  indentLeft?: number
  indentFirstLine?: number
  outlineLevel?: number
}

export interface DocumentStyle {
  id: string
  type: StyleType
  /** Display name from `w:name`, which is what a style dropdown should show. */
  name: string
  basedOn: string | null
  /** Style applied to the paragraph that follows, e.g. Heading 1 → Normal. */
  next: string | null
  isDefault: boolean
  /** Word hides styles flagged `w:semiHidden` from its own gallery. */
  hidden: boolean
  /** Formatting declared on this style alone, before inheritance. */
  own: StyleFormatting
}

export interface StyleCatalogue {
  styles: Map<string, DocumentStyle>
  /** Document defaults from `w:docDefaults`, the root of every chain. */
  defaults: StyleFormatting
  defaultParagraphStyleId: string | null
}

function parseRunFormatting(rPr: XmlNode | undefined, into: StyleFormatting): void {
  if (!rPr) return

  for (const property of children(rPr)) {
    const tag = tagName(property)
    const value = attribute(property, 'w:val')

    switch (tag) {
      case 'w:b':
        into.bold = parseToggle(value)
        break
      case 'w:i':
        into.italic = parseToggle(value)
        break
      case 'w:strike':
        into.strike = parseToggle(value)
        break
      case 'w:u':
        into.underline = value !== undefined && value !== 'none'
        break
      case 'w:sz': {
        const halfPoints = parseIntAttribute(value)
        if (halfPoints !== null) into.fontSize = halfPointsToPoints(halfPoints)
        break
      }
      case 'w:color': {
        const color = parseColor(value)
        if (color !== null) into.color = color
        break
      }
      case 'w:rFonts': {
        const family = attribute(property, 'w:ascii') ?? attribute(property, 'w:hAnsi')
        if (family !== undefined) into.fontFamily = family
        break
      }
      default:
        break
    }
  }
}

function parseParagraphFormatting(pPr: XmlNode | undefined, into: StyleFormatting): void {
  if (!pPr) return

  for (const property of children(pPr)) {
    const tag = tagName(property)
    const value = attribute(property, 'w:val')

    switch (tag) {
      case 'w:jc':
        into.textAlign = value === 'both' ? 'justify' : value
        break
      case 'w:outlineLvl': {
        const level = parseIntAttribute(value)
        // OOXML counts outline levels from 0; headings are 1-based.
        if (level !== null) into.outlineLevel = level + 1
        break
      }
      case 'w:spacing': {
        const line = parseIntAttribute(attribute(property, 'w:line'))
        const lineRule = attribute(property, 'w:lineRule')
        if (line !== null && (lineRule === undefined || lineRule === 'auto')) {
          into.lineHeight = lineUnitsToMultiplier(line)
        }
        const before = parseIntAttribute(attribute(property, 'w:before'))
        const after = parseIntAttribute(attribute(property, 'w:after'))
        if (before !== null) into.spaceBefore = twipsToPoints(before)
        if (after !== null) into.spaceAfter = twipsToPoints(after)
        break
      }
      case 'w:ind': {
        const left = parseIntAttribute(
          attribute(property, 'w:left') ?? attribute(property, 'w:start'),
        )
        const firstLine = parseIntAttribute(attribute(property, 'w:firstLine'))
        const hanging = parseIntAttribute(attribute(property, 'w:hanging'))
        if (left !== null) into.indentLeft = twipsToPoints(left)
        if (firstLine !== null) into.indentFirstLine = twipsToPoints(firstLine)
        else if (hanging !== null) into.indentFirstLine = -twipsToPoints(hanging)
        break
      }
      default:
        break
    }
  }
}

function parseStyleType(value: string | undefined): StyleType {
  switch (value) {
    case 'character':
    case 'table':
    case 'numbering':
      return value
    default:
      return 'paragraph'
  }
}

export function parseStyles(xml: string): StyleCatalogue {
  const catalogue: StyleCatalogue = {
    styles: new Map(),
    defaults: {},
    defaultParagraphStyleId: null,
  }

  const root = parseXml(xml).find((node) => tagName(node) === 'w:styles')
  if (!root) return catalogue

  const docDefaults = findChild(root, 'w:docDefaults')
  if (docDefaults) {
    const runDefaults = findChild(docDefaults, 'w:rPrDefault')
    const paragraphDefaults = findChild(docDefaults, 'w:pPrDefault')
    parseRunFormatting(
      runDefaults ? findChild(runDefaults, 'w:rPr') : undefined,
      catalogue.defaults,
    )
    parseParagraphFormatting(
      paragraphDefaults ? findChild(paragraphDefaults, 'w:pPr') : undefined,
      catalogue.defaults,
    )
  }

  for (const node of children(root)) {
    if (tagName(node) !== 'w:style') continue

    const id = attribute(node, 'w:styleId')
    if (id === undefined) continue

    const own: StyleFormatting = {}
    parseParagraphFormatting(findChild(node, 'w:pPr'), own)
    parseRunFormatting(findChild(node, 'w:rPr'), own)

    const style: DocumentStyle = {
      id,
      type: parseStyleType(attribute(node, 'w:type')),
      name: attribute(findChild(node, 'w:name') ?? {}, 'w:val') ?? id,
      basedOn: attribute(findChild(node, 'w:basedOn') ?? {}, 'w:val') ?? null,
      next: attribute(findChild(node, 'w:next') ?? {}, 'w:val') ?? null,
      isDefault:
        parseToggle(attribute(node, 'w:default')) && attribute(node, 'w:default') !== undefined,
      hidden: findChild(node, 'w:semiHidden') !== undefined,
      own,
    }

    catalogue.styles.set(id, style)

    if (style.isDefault && style.type === 'paragraph') {
      catalogue.defaultParagraphStyleId = id
    }
  }

  return catalogue
}

/**
 * Walks the `w:basedOn` chain and merges formatting from the root down, so a
 * leaf style overrides what it inherits. Cycles — which malformed files do
 * contain — are broken rather than followed.
 */
export function resolveStyle(catalogue: StyleCatalogue, styleId: string): StyleFormatting {
  const chain: DocumentStyle[] = []
  const seen = new Set<string>()

  let current: string | null = styleId
  while (current !== null && !seen.has(current)) {
    seen.add(current)
    const style: DocumentStyle | undefined = catalogue.styles.get(current)
    if (!style) break
    chain.unshift(style)
    current = style.basedOn
  }

  const resolved: StyleFormatting = { ...catalogue.defaults }
  for (const style of chain) Object.assign(resolved, style.own)
  return resolved
}

/** Styles a style dropdown should offer: paragraph styles Word does not hide. */
export function visibleParagraphStyles(catalogue: StyleCatalogue): DocumentStyle[] {
  return [...catalogue.styles.values()]
    .filter((style) => style.type === 'paragraph' && !style.hidden)
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Heading level a style implies, from its outline level or its id. */
export function headingLevelOf(catalogue: StyleCatalogue, styleId: string): number | null {
  const resolved = resolveStyle(catalogue, styleId)
  if (resolved.outlineLevel !== undefined && resolved.outlineLevel <= 6) {
    return resolved.outlineLevel
  }

  const match = /^Heading([1-6])$/i.exec(styleId)
  return match?.[1] ? Number.parseInt(match[1], 10) : null
}
