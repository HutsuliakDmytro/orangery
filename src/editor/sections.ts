import { parseSection } from '../ooxml/section'
import type { SectionProperties } from '../ooxml/section'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * Which page setup is in force where.
 *
 * A section runs up to and including the break that ends it, and the last one
 * runs to the end of the document with the page setup held for the body. So the
 * section a position belongs to is the first break at or after it — the break
 * carries the setup of the text *above* it, not below.
 */

export interface DocumentSection {
  /** Where the section starts, in document positions. */
  from: number
  /** One past its last block; the end of the document for the last section. */
  to: number
  /** Position of the break that ends it, or null when the body holds it. */
  breakPosition: number | null
  properties: SectionProperties
}

export function sectionsOf(doc: ProseMirrorNode, body: SectionProperties): DocumentSection[] {
  const sections: DocumentSection[] = []
  let from = 0

  doc.forEach((node, position) => {
    if (node.type.name !== 'sectionBreak') return

    const sectPr: unknown = node.attrs['sectPr']
    sections.push({
      from,
      to: position + node.nodeSize,
      breakPosition: position,
      properties: parseSection(typeof sectPr === 'string' ? sectPr : null),
    })

    from = position + node.nodeSize
  })

  sections.push({
    from,
    to: doc.content.size,
    breakPosition: null,
    properties: body,
  })

  return sections
}

/** The section a position sits in. There is always one: the body's. */
export function sectionAt(
  doc: ProseMirrorNode,
  position: number,
  body: SectionProperties,
): DocumentSection {
  const sections = sectionsOf(doc, body)
  const found = sections.find((section) => position < section.to)

  // Past the last break is the last section, which is the one the body holds.
  return found ?? (sections[sections.length - 1] as DocumentSection)
}
