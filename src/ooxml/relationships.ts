import { attribute, buildXml, children, element, parseXml, tagName, withDeclaration } from './xml'

/**
 * Package relationships — `word/_rels/document.xml.rels`.
 *
 * Nothing in `document.xml` names a file directly. An image says
 * `r:embed="rId7"`, a hyperlink says `r:id="rId5"`, and the rels part maps those
 * ids to targets. Adding an image therefore means adding a relationship, not
 * just a media file — a picture whose id is not in the rels part makes Word
 * offer to repair the document.
 */

export const IMAGE_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image'
export const HYPERLINK_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'

export interface Relationship {
  id: string
  type: string
  target: string
  /** External targets (hyperlinks) are not package parts. */
  external: boolean
}

export function parseRelationships(xml: string): Map<string, Relationship> {
  const relationships = new Map<string, Relationship>()

  const root = parseXml(xml).find((node) => tagName(node) === 'Relationships')
  if (!root) return relationships

  for (const node of children(root)) {
    if (tagName(node) !== 'Relationship') continue

    const id = attribute(node, 'Id')
    const type = attribute(node, 'Type')
    const target = attribute(node, 'Target')
    if (id === undefined || type === undefined || target === undefined) continue

    relationships.set(id, {
      id,
      type,
      target,
      external: attribute(node, 'TargetMode') === 'External',
    })
  }

  return relationships
}

export function serializeRelationships(relationships: Map<string, Relationship>): string {
  const nodes = [...relationships.values()].map((relationship) =>
    element('Relationship', {
      Id: relationship.id,
      Type: relationship.type,
      Target: relationship.target,
      ...(relationship.external ? { TargetMode: 'External' } : {}),
    }),
  )

  return withDeclaration(
    buildXml([
      element(
        'Relationships',
        { xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships' },
        nodes,
      ),
    ]),
  )
}

/**
 * Next free `rIdN`. Word numbers them sequentially but does not require it; the
 * only hard rule is uniqueness within the part.
 */
export function nextRelationshipId(relationships: Map<string, Relationship>): string {
  let highest = 0
  for (const id of relationships.keys()) {
    const match = /^rId(\d+)$/u.exec(id)
    if (match?.[1]) highest = Math.max(highest, Number.parseInt(match[1], 10))
  }
  return `rId${String(highest + 1)}`
}

export function addRelationship(
  relationships: Map<string, Relationship>,
  type: string,
  target: string,
  external = false,
): Relationship {
  const relationship: Relationship = {
    id: nextRelationshipId(relationships),
    type,
    target,
    external,
  }
  relationships.set(relationship.id, relationship)
  return relationship
}

/** Resolves a relationship target to its package path. */
export function resolveTarget(target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  // Targets are relative to `word/`, the part that owns the rels file.
  return `word/${target.replace(/^\.\//u, '')}`
}

export function findByTarget(
  relationships: Map<string, Relationship>,
  target: string,
): Relationship | undefined {
  return [...relationships.values()].find((relationship) => relationship.target === target)
}
