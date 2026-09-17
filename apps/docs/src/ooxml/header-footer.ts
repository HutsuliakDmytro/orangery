import { attribute, buildXml, children, element, parseXml, tagName, withDeclaration } from './xml'
import type { XmlNode } from './xml'

/**
 * Headers and footers.
 *
 * They are separate package parts (`word/header1.xml`), referenced from
 * `w:sectPr` by relationship id. A section can name three of each — first page,
 * even pages, default — and Word picks one per page. The MVP edits the default
 * pair and preserves the others untouched, which is honest about what it can do
 * rather than silently collapsing three into one.
 */

export type HeaderFooterKind = 'header' | 'footer'
export type HeaderFooterType = 'default' | 'first' | 'even'

export interface HeaderFooterReference {
  kind: HeaderFooterKind
  type: HeaderFooterType
  relationshipId: string
}

export const HEADER_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/header'
export const FOOTER_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer'

export const HEADER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
export const FOOTER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'

function parseType(value: string | undefined): HeaderFooterType {
  return value === 'first' || value === 'even' ? value : 'default'
}

/** Reads the header and footer references out of a preserved `w:sectPr`. */
export function parseReferences(preserved: readonly string[]): HeaderFooterReference[] {
  const references: HeaderFooterReference[] = []

  for (const fragment of preserved) {
    for (const node of parseXml(fragment)) {
      const tag = tagName(node)
      if (tag !== 'w:headerReference' && tag !== 'w:footerReference') continue

      const relationshipId = attribute(node, 'r:id')
      if (relationshipId === undefined) continue

      references.push({
        kind: tag === 'w:headerReference' ? 'header' : 'footer',
        type: parseType(attribute(node, 'w:type')),
        relationshipId,
      })
    }
  }

  return references
}

export function findReference(
  references: readonly HeaderFooterReference[],
  kind: HeaderFooterKind,
  type: HeaderFooterType = 'default',
): HeaderFooterReference | undefined {
  return references.find((reference) => reference.kind === kind && reference.type === type)
}

/**
 * A page number field.
 *
 * Word writes fields as a run sequence: `fldChar begin`, `instrText` holding the
 * field code, `fldChar separate`, the cached result, `fldChar end`. Readers that
 * do not evaluate fields show the cached result, so it is filled in with
 * something plausible rather than left blank.
 */
export function pageNumberField(cachedValue = '1'): XmlNode[] {
  return [
    element('w:r', {}, [element('w:fldChar', { 'w:fldCharType': 'begin' })]),
    element('w:r', {}, [
      element('w:instrText', { 'xml:space': 'preserve' }, [{ '#text': ' PAGE ' }]),
    ]),
    element('w:r', {}, [element('w:fldChar', { 'w:fldCharType': 'separate' })]),
    element('w:r', {}, [element('w:t', {}, [{ '#text': cachedValue }])]),
    element('w:r', {}, [element('w:fldChar', { 'w:fldCharType': 'end' })]),
  ]
}

/** A date field. `\@` selects the display format, as in Word's own dialog. */
export function dateField(format = 'd MMMM yyyy', cachedValue = ''): XmlNode[] {
  return [
    element('w:r', {}, [element('w:fldChar', { 'w:fldCharType': 'begin' })]),
    element('w:r', {}, [
      element('w:instrText', { 'xml:space': 'preserve' }, [{ '#text': ` DATE \\@ "${format}" ` }]),
    ]),
    element('w:r', {}, [element('w:fldChar', { 'w:fldCharType': 'separate' })]),
    element('w:r', {}, [element('w:t', {}, [{ '#text': cachedValue }])]),
    element('w:r', {}, [element('w:fldChar', { 'w:fldCharType': 'end' })]),
  ]
}

/** The XML for a new, empty header or footer part. */
export function emptyPart(kind: HeaderFooterKind): string {
  const root = kind === 'header' ? 'w:hdr' : 'w:ftr'

  return withDeclaration(
    buildXml([
      element(
        root,
        {
          'xmlns:w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
          'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        },
        [element('w:p')],
      ),
    ]),
  )
}

/** Paragraph nodes of a header or footer part, for the parser to read. */
export function partParagraphs(xml: string): XmlNode[] {
  const root = parseXml(xml).find((node) => {
    const tag = tagName(node)
    return tag === 'w:hdr' || tag === 'w:ftr'
  })

  if (!root) return []
  return children(root).filter((node) => tagName(node) === 'w:p')
}

/** Rebuilds a part around new paragraphs, keeping the root element as it was. */
export function rebuildPart(xml: string, paragraphs: XmlNode[], kind: HeaderFooterKind): string {
  const roots = parseXml(xml)
  const root = roots.find((node) => {
    const tag = tagName(node)
    return tag === 'w:hdr' || tag === 'w:ftr'
  })

  if (!root) return rebuildPart(emptyPart(kind), paragraphs, kind)

  const tag = tagName(root)
  if (tag === null) return emptyPart(kind)

  // Anything that is not a paragraph — section-level properties, bookmarks —
  // stays where it was; only the paragraphs are replaced.
  const others = children(root).filter((node) => tagName(node) !== 'w:p')
  root[tag] = [...paragraphs, ...others]

  return withDeclaration(buildXml(roots))
}
