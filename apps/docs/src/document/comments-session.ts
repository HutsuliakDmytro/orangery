import {
  writeRelationships,
  setPartXml,
  CONTENT_TYPES_PART,
  addRelationship,
  attribute,
  children,
  element,
  findByTarget,
  getPartText,
  parseRelationships,
  parseXml,
  setPartText,
  tagName,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import {
  COMMENTS_CONTENT_TYPE,
  COMMENTS_PART,
  COMMENTS_RELATIONSHIP,
  parseComments,
  serializeComments,
} from '../ooxml/comments'
import type { Comment } from '../ooxml/comments'
import type { ProseMirrorNodeJson } from '../ooxml/prosemirror-json'
import { DOCUMENT_RELS_PART } from './media'

/**
 * The document's comments, in the package.
 *
 * Like the footnotes, a comments part needs a relationship and a content-type
 * override as well as the part itself — Word repairs a file where any of the
 * three is missing.
 */

export function readComments(pkg: OoxmlPackage): Map<number, Comment> {
  return parseComments(getPartText(pkg, COMMENTS_PART) ?? '')
}

function ensureOverride(pkg: OoxmlPackage): void {
  const xml = getPartText(pkg, CONTENT_TYPES_PART)
  if (xml === undefined) return

  const roots = parseXml(xml)
  const types = roots.find((node) => tagName(node) === 'Types')
  if (!types) return

  const partName = `/${COMMENTS_PART}`
  const already = children(types).some(
    (node) => tagName(node) === 'Override' && attribute(node, 'PartName') === partName,
  )
  if (already) return

  const list: unknown = types['Types']
  if (!Array.isArray(list)) return

  ;(list as XmlNode[]).push(
    element('Override', { PartName: partName, ContentType: COMMENTS_CONTENT_TYPE }),
  )
  setPartXml(pkg, CONTENT_TYPES_PART, roots)
}

function ensureRelationship(pkg: OoxmlPackage): void {
  const relationships = parseRelationships(getPartText(pkg, DOCUMENT_RELS_PART) ?? '')
  if (findByTarget(relationships, 'comments.xml')) return

  addRelationship(relationships, COMMENTS_RELATIONSHIP, 'comments.xml')
  writeRelationships(pkg, DOCUMENT_RELS_PART, relationships)
}

/** Every comment id the body still points at. */
export function anchoredComments(doc: ProseMirrorNodeJson): Set<number> {
  const found = new Set<number>()

  const walk = (node: ProseMirrorNodeJson): void => {
    for (const mark of node.marks ?? []) {
      const id = mark.attrs?.['commentId']
      if (mark.type === 'comment' && typeof id === 'number') found.add(id)
    }
    for (const child of node.content ?? []) walk(child)
  }

  walk(doc)
  return found
}

/**
 * Writes the comments into the package.
 *
 * A comment the body no longer points at is dropped: its text would otherwise
 * stay in the file for ever, attached to nothing and shown by nobody.
 */
export function writeComments(
  pkg: OoxmlPackage,
  comments: ReadonlyMap<number, Comment>,
  doc: ProseMirrorNodeJson,
): void {
  const anchored = anchoredComments(doc)
  const kept = new Map([...comments].filter(([id]) => anchored.has(id)))

  // Nothing to write and nothing there before: leave the package alone rather
  // than adding an empty part to a document that never had one.
  if (kept.size === 0 && getPartText(pkg, COMMENTS_PART) === undefined) return

  setPartText(pkg, COMMENTS_PART, serializeComments(kept, getPartText(pkg, COMMENTS_PART)))
  ensureOverride(pkg)
  ensureRelationship(pkg)
}
