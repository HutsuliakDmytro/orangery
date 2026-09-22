import { attribute, children, element, parseXml, tagName } from './xml'
import { preservingRoot } from './preserve'

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

export function serializeRelationships(
  relationships: Map<string, Relationship>,
  previous?: string,
): string {
  const nodes = [...relationships.values()].map((relationship) =>
    element('Relationship', {
      Id: relationship.id,
      Type: relationship.type,
      Target: relationship.target,
      ...(relationship.external ? { TargetMode: 'External' } : {}),
    }),
  )

  // `previous` is the part as it was read: a `.rels` LibreOffice wrote has no
  // `standalone` in its declaration and ours does, which is a difference in
  // every `.rels` we rewrite and a change to nothing at all.
  return preservingRoot(previous, [
    element(
      'Relationships',
      { xmlns: 'http://schemas.openxmlformats.org/package/2006/relationships' },
      nodes,
    ),
  ])
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

/**
 * Resolves a relationship target to its path in the package.
 *
 * `base` is the directory of the part that owns the rels file — `word` for a
 * document's, `ppt/slides` for a slide's. It used to be hardcoded to `word`,
 * which was fine while documents were the only format: a deck's rels reach
 * sideways with `../slideLayouts/slideLayout1.xml`, and that has to land in
 * `ppt/slideLayouts/`, not under the slide.
 */
export function resolveTarget(target: string, base: string): string {
  // An absolute target is already a package path, minus the leading slash.
  if (target.startsWith('/')) return target.slice(1)

  const segments = [...base.split('/').filter(Boolean), ...target.split('/')]
  const path: string[] = []

  for (const segment of segments) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      path.pop()
      continue
    }
    path.push(segment)
  }

  return path.join('/')
}

/** The directory a part lives in, which is the base for its own relationships. */
export function partDirectory(path: string): string {
  const cut = path.lastIndexOf('/')
  return cut === -1 ? '' : path.slice(0, cut)
}

/**
 * Writes a relationships part, keeping the declaration it had.
 *
 * The form to reach for: the package has the old text, so a caller that only
 * wants to add a relationship does not have to remember to keep the rest.
 */
export function writeRelationships(
  pkg: { parts: Map<string, { path: string; text?: string; bytes: Uint8Array; date: Date }> },
  path: string,
  relationships: Map<string, Relationship>,
): void {
  const previous = pkg.parts.get(path)?.text
  const text = serializeRelationships(relationships, previous)
  const bytes = new TextEncoder().encode(text)
  pkg.parts.set(path, { path, text, bytes, date: pkg.parts.get(path)?.date ?? new Date() })
}

export function findByTarget(
  relationships: Map<string, Relationship>,
  target: string,
): Relationship | undefined {
  return [...relationships.values()].find((relationship) => relationship.target === target)
}
