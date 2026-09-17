import {
  CONTENT_TYPES_PART,
  addRelationship,
  attribute,
  buildXml,
  children,
  element,
  getPartText,
  parseRelationships,
  parseXml,
  resolveTarget,
  serializeRelationships,
  setPartText,
  tagName,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import {
  emptyPart,
  findReference,
  parseReferences,
  partParagraphs,
  rebuildPart,
} from '../ooxml/header-footer'
import type { HeaderFooterKind, HeaderFooterType } from '../ooxml/header-footer'
import {
  FOOTER_CONTENT_TYPE,
  FOOTER_RELATIONSHIP,
  HEADER_CONTENT_TYPE,
  HEADER_RELATIONSHIP,
} from '../ooxml/header-footer'
import type { SectionProperties } from '../ooxml/section'
import { DOCUMENT_RELS_PART } from './media'

/**
 * Reading and writing a document's headers and footers.
 *
 * Creating one means four coordinated changes — part, relationship, content-type
 * override and a `w:headerReference` in `w:sectPr` — for the same reason images
 * need three: Word repairs a file where any of them is missing.
 *
 * A section can carry more than one of each: the default, and a `first` used on
 * the opening page when `w:titlePg` is set. They are separate parts pointed at
 * by references of different types, which is why the type is threaded through
 * rather than assumed.
 */

export interface HeaderFooterContent {
  kind: HeaderFooterKind
  /** Package path of the part, or null when the document has none. */
  path: string | null
  paragraphs: XmlNode[]
}

function partPathFor(pkg: OoxmlPackage, kind: HeaderFooterKind): string {
  let index = 1
  while (pkg.parts.has(`word/${kind}${String(index)}.xml`)) index += 1
  return `word/${kind}${String(index)}.xml`
}

export function readHeaderFooter(
  pkg: OoxmlPackage,
  section: SectionProperties,
  kind: HeaderFooterKind,
  type: HeaderFooterType = 'default',
): HeaderFooterContent {
  const reference = findReference(parseReferences(section.preserved), kind, type)
  if (!reference) return { kind, path: null, paragraphs: [] }

  const relationships = parseRelationships(getPartText(pkg, DOCUMENT_RELS_PART) ?? '')
  const relationship = relationships.get(reference.relationshipId)
  if (!relationship) return { kind, path: null, paragraphs: [] }

  const path = resolveTarget(relationship.target, 'word')
  const xml = getPartText(pkg, path)
  if (xml === undefined) return { kind, path: null, paragraphs: [] }

  return { kind, path, paragraphs: partParagraphs(xml) }
}

/** Adds a content-type override for a part, which headers and footers need. */
function ensureOverride(pkg: OoxmlPackage, partName: string, contentType: string): void {
  const xml = getPartText(pkg, CONTENT_TYPES_PART)
  if (xml === undefined) return

  const roots = parseXml(xml)
  const types = roots.find((node) => tagName(node) === 'Types')
  if (!types) return

  const already = children(types).some(
    (node) => tagName(node) === 'Override' && attribute(node, 'PartName') === partName,
  )
  if (already) return

  const list = types['Types']
  if (!Array.isArray(list)) return

  ;(list as XmlNode[]).push(element('Override', { PartName: partName, ContentType: contentType }))
  setPartText(pkg, CONTENT_TYPES_PART, withDeclaration(buildXml(roots)))
}

/**
 * Writes the paragraphs into the document's header or footer, creating the part
 * and its wiring when there is none yet.
 *
 * Returns the section, with a reference added when one had to be created.
 */
export function writeHeaderFooter(
  pkg: OoxmlPackage,
  section: SectionProperties,
  kind: HeaderFooterKind,
  paragraphs: XmlNode[],
  type: HeaderFooterType = 'default',
): SectionProperties {
  const existing = readHeaderFooter(pkg, section, kind, type)

  if (existing.path !== null) {
    const current = getPartText(pkg, existing.path) ?? emptyPart(kind)
    setPartText(pkg, existing.path, rebuildPart(current, paragraphs, kind))
    return section
  }

  const path = partPathFor(pkg, kind)
  setPartText(pkg, path, rebuildPart(emptyPart(kind), paragraphs, kind))

  ensureOverride(pkg, `/${path}`, kind === 'header' ? HEADER_CONTENT_TYPE : FOOTER_CONTENT_TYPE)

  const relationships = parseRelationships(getPartText(pkg, DOCUMENT_RELS_PART) ?? '')
  const relationship = addRelationship(
    relationships,
    kind === 'header' ? HEADER_RELATIONSHIP : FOOTER_RELATIONSHIP,
    path.replace(/^word\//u, ''),
  )
  setPartText(pkg, DOCUMENT_RELS_PART, serializeRelationships(relationships))

  // The reference joins the preserved children of `w:sectPr`, which is where
  // the parser found the ones the file already had.
  const referenceTag = kind === 'header' ? 'w:headerReference' : 'w:footerReference'
  return {
    ...section,
    preserved: [
      `<${referenceTag} w:type="${type}" r:id="${relationship.id}"/>`,
      ...section.preserved,
    ],
  }
}
