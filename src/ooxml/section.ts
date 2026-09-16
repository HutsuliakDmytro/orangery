import { attribute, children, element, parseXml, serializeNode, tagName } from './xml'
import type { XmlNode } from './xml'
import { parseIntAttribute, pointsToTwips, twipsToPoints } from './units'

/**
 * Section properties — OOXML `w:sectPr`.
 *
 * Until now this was kept verbatim so it survived a round-trip. Page setup needs
 * to read and change page size, margins and orientation, so those are modelled;
 * every other child of `w:sectPr` (headers, footers, columns, page numbering) is
 * still preserved untouched, which keeps the guarantee intact.
 */

export type PageOrientation = 'portrait' | 'landscape'

export interface PageMargins {
  top: number
  right: number
  bottom: number
  left: number
  header: number
  footer: number
  gutter: number
}

export interface SectionProperties {
  /** Page width in points. */
  width: number
  height: number
  orientation: PageOrientation
  margins: PageMargins
  /** Children of `w:sectPr` we do not model, serialised and written back as-is. */
  preserved: string[]
}

/** Common page sizes, in points. Letter is Word's default in US locales. */
export const PAGE_SIZES = [
  { id: 'letter', label: 'Letter', width: 612, height: 792 },
  { id: 'legal', label: 'Legal', width: 612, height: 1008 },
  { id: 'tabloid', label: 'Tabloid', width: 792, height: 1224 },
  { id: 'a3', label: 'A3', width: 841.89, height: 1190.55 },
  { id: 'a4', label: 'A4', width: 595.28, height: 841.89 },
  { id: 'a5', label: 'A5', width: 419.53, height: 595.28 },
  { id: 'b5', label: 'B5', width: 498.9, height: 708.66 },
] as const

export type PageSizeId = (typeof PAGE_SIZES)[number]['id']

export const DEFAULT_MARGINS: PageMargins = {
  top: 72,
  right: 72,
  bottom: 72,
  left: 72,
  header: 36,
  footer: 36,
  gutter: 0,
}

export const DEFAULT_SECTION: SectionProperties = {
  width: 612,
  height: 792,
  orientation: 'portrait',
  margins: DEFAULT_MARGINS,
  preserved: [],
}

const MODELLED = new Set(['w:pgSz', 'w:pgMar'])

/** Matches a known page size within half a point, which covers rounding in twips. */
export function pageSizeIdFor(width: number, height: number): PageSizeId | null {
  const matches = (a: number, b: number) => Math.abs(a - b) < 0.5

  for (const size of PAGE_SIZES) {
    if (matches(width, size.width) && matches(height, size.height)) return size.id
    // A landscape page is the same sheet turned round.
    if (matches(width, size.height) && matches(height, size.width)) return size.id
  }
  return null
}

export function parseSection(xml: string | null): SectionProperties {
  if (xml === null || xml === '') return { ...DEFAULT_SECTION, margins: { ...DEFAULT_MARGINS } }

  const root = parseXml(xml).find((node) => tagName(node) === 'w:sectPr')
  if (!root) return { ...DEFAULT_SECTION, margins: { ...DEFAULT_MARGINS } }

  const section: SectionProperties = {
    ...DEFAULT_SECTION,
    margins: { ...DEFAULT_MARGINS },
    preserved: [],
  }

  for (const child of children(root)) {
    const tag = tagName(child)

    if (tag === 'w:pgSz') {
      const width = parseIntAttribute(attribute(child, 'w:w'))
      const height = parseIntAttribute(attribute(child, 'w:h'))
      if (width !== null) section.width = twipsToPoints(width)
      if (height !== null) section.height = twipsToPoints(height)
      // Word omits `w:orient` for portrait, so absence means portrait.
      section.orientation = attribute(child, 'w:orient') === 'landscape' ? 'landscape' : 'portrait'
      continue
    }

    if (tag === 'w:pgMar') {
      const read = (name: string, fallback: number): number => {
        const value = parseIntAttribute(attribute(child, name))
        return value === null ? fallback : twipsToPoints(value)
      }
      section.margins = {
        top: read('w:top', DEFAULT_MARGINS.top),
        right: read('w:right', DEFAULT_MARGINS.right),
        bottom: read('w:bottom', DEFAULT_MARGINS.bottom),
        left: read('w:left', DEFAULT_MARGINS.left),
        header: read('w:header', DEFAULT_MARGINS.header),
        footer: read('w:footer', DEFAULT_MARGINS.footer),
        gutter: read('w:gutter', DEFAULT_MARGINS.gutter),
      }
      continue
    }

    if (tag !== null && !MODELLED.has(tag)) section.preserved.push(serializeNode(child))
  }

  return section
}

export function serializeSection(section: SectionProperties): string {
  const nodes: XmlNode[] = []

  // Word writes pgSz and pgMar first; the preserved children follow in their
  // original order.
  nodes.push(
    element('w:pgSz', {
      'w:w': String(pointsToTwips(section.width)),
      'w:h': String(pointsToTwips(section.height)),
      ...(section.orientation === 'landscape' ? { 'w:orient': 'landscape' } : {}),
    }),
  )

  nodes.push(
    element('w:pgMar', {
      'w:top': String(pointsToTwips(section.margins.top)),
      'w:right': String(pointsToTwips(section.margins.right)),
      'w:bottom': String(pointsToTwips(section.margins.bottom)),
      'w:left': String(pointsToTwips(section.margins.left)),
      'w:header': String(pointsToTwips(section.margins.header)),
      'w:footer': String(pointsToTwips(section.margins.footer)),
      'w:gutter': String(pointsToTwips(section.margins.gutter)),
    }),
  )

  for (const preserved of section.preserved) {
    nodes.push(...parseXml(preserved))
  }

  return serializeNode(element('w:sectPr', {}, nodes))
}

/** Swaps width and height, which is what "rotate the page" means in OOXML. */
export function withOrientation(
  section: SectionProperties,
  orientation: PageOrientation,
): SectionProperties {
  if (section.orientation === orientation) return section

  return {
    ...section,
    orientation,
    width: section.height,
    height: section.width,
  }
}

export function withPageSize(section: SectionProperties, id: PageSizeId): SectionProperties {
  const size = PAGE_SIZES.find((entry) => entry.id === id)
  if (!size) return section

  const landscape = section.orientation === 'landscape'
  return {
    ...section,
    width: landscape ? size.height : size.width,
    height: landscape ? size.width : size.height,
  }
}

/** Width of the text column: the page minus its side margins and gutter. */
export function contentWidth(section: SectionProperties): number {
  return section.width - section.margins.left - section.margins.right - section.margins.gutter
}

export function contentHeight(section: SectionProperties): number {
  return section.height - section.margins.top - section.margins.bottom
}
