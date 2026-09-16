import {
  FOOTNOTES_CONTENT_TYPE,
  FOOTNOTES_PART,
  FOOTNOTES_RELATIONSHIP,
  footnoteParagraph,
  isRealFootnote,
  separatorFootnotes,
  serializeFootnotes,
} from '../ooxml/footnotes'
import type { Footnote } from '../ooxml/footnotes'
import { CONTENT_TYPES_PART, getPartText, setPartText } from '../ooxml/package'
import type { DocxPackage } from '../ooxml/package'
import {
  addRelationship,
  findByTarget,
  parseRelationships,
  serializeRelationships,
} from '../ooxml/relationships'
import {
  attribute,
  buildXml,
  children,
  element,
  parseXml,
  tagName,
  withDeclaration,
} from '../ooxml/xml'
import type { XmlNode } from '../ooxml/xml'
import type { ProseMirrorNodeJson } from '../ooxml/prosemirror-json'
import { DOCUMENT_RELS_PART } from './media'

/**
 * Writing the document's footnotes back into the package.
 *
 * Like headers, a footnotes part needs a relationship and a content-type
 * override as well as the part itself. The separator entries are recreated if a
 * document did not have them: Word draws the rule above the footnote area from
 * those, and a part without them renders the notes with no separator at all.
 */

/** Footnote markers in the document, in the order they appear. */
export function collectFootnotes(doc: ProseMirrorNodeJson): { id: number; text: string }[] {
  const found: { id: number; text: string }[] = []

  const walk = (node: ProseMirrorNodeJson): void => {
    if (node.type === 'footnote') {
      const id = node.attrs?.['footnoteId']
      const text = node.attrs?.['text']
      if (typeof id === 'number') {
        found.push({ id, text: typeof text === 'string' ? text : '' })
      }
      return
    }
    for (const child of node.content ?? []) walk(child)
  }

  walk(doc)
  return found
}

function ensureOverride(pkg: DocxPackage): void {
  const xml = getPartText(pkg, CONTENT_TYPES_PART)
  if (xml === undefined) return

  const roots = parseXml(xml)
  const types = roots.find((node) => tagName(node) === 'Types')
  if (!types) return

  const partName = `/${FOOTNOTES_PART}`
  const already = children(types).some(
    (node) => tagName(node) === 'Override' && attribute(node, 'PartName') === partName,
  )
  if (already) return

  const list = types['Types']
  if (!Array.isArray(list)) return

  ;(list as XmlNode[]).push(
    element('Override', { PartName: partName, ContentType: FOOTNOTES_CONTENT_TYPE }),
  )
  setPartText(pkg, CONTENT_TYPES_PART, withDeclaration(buildXml(roots)))
}

function ensureRelationship(pkg: DocxPackage): void {
  const relationships = parseRelationships(getPartText(pkg, DOCUMENT_RELS_PART) ?? '')
  if (findByTarget(relationships, 'footnotes.xml')) return

  addRelationship(relationships, FOOTNOTES_RELATIONSHIP, 'footnotes.xml')
  setPartText(pkg, DOCUMENT_RELS_PART, serializeRelationships(relationships))
}

/**
 * Merges the editor's footnotes into the package.
 *
 * Notes the document no longer references are dropped; notes whose text changed
 * are rewritten; everything else — including entries we never modelled — is left
 * as it was.
 */
export function writeFootnotes(
  pkg: DocxPackage,
  existing: Map<number, Footnote>,
  doc: ProseMirrorNodeJson,
): void {
  const inDocument = collectFootnotes(doc)

  // Nothing to write and nothing there before: leave the package alone rather
  // than adding an empty part to a document that never had one.
  if (inDocument.length === 0 && existing.size === 0) return

  const merged = new Map<number, Footnote>()

  // Separators first, recreated when the source lacked them.
  for (const [id, footnote] of existing) {
    if (!isRealFootnote(footnote)) merged.set(id, footnote)
  }
  if (merged.size === 0) {
    for (const [id, footnote] of separatorFootnotes()) merged.set(id, footnote)
  }

  for (const note of inDocument) {
    const before = existing.get(note.id)
    merged.set(note.id, {
      id: note.id,
      type: null,
      // Rewritten only when the text actually changed, so a note the user did
      // not touch keeps whatever formatting it came with.
      paragraphs:
        before !== undefined && textOf(before) === note.text
          ? before.paragraphs
          : [footnoteParagraph(note.text)],
    })
  }

  setPartText(pkg, FOOTNOTES_PART, serializeFootnotes(merged))
  ensureOverride(pkg)
  ensureRelationship(pkg)
}

function textOf(footnote: Footnote): string {
  const collect = (node: XmlNode): string => {
    if ('#text' in node) {
      const value = node['#text']
      return typeof value === 'string' ? value : ''
    }
    return children(node).map(collect).join('')
  }
  return footnote.paragraphs.map(collect).join('\n').trim()
}
