import { contentTypeFor } from '../ooxml/image'
import { CONTENT_TYPES_PART, getPartText, setPartText } from '../ooxml/package'
import type { DocxPackage } from '../ooxml/package'
import {
  addRelationship,
  IMAGE_RELATIONSHIP,
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

/**
 * Adding an image to a DOCX package.
 *
 * Three things have to change together, and a file with any one missing makes
 * Word offer to repair it:
 *   1. the bytes land under `word/media/`,
 *   2. a relationship points at them from `word/_rels/document.xml.rels`,
 *   3. `[Content_Types].xml` declares how to read that extension.
 */

export const DOCUMENT_RELS_PART = 'word/_rels/document.xml.rels'

export interface AddedMedia {
  relationshipId: string
  /** Package path, e.g. `word/media/image3.png`. */
  path: string
}

/** Next free `imageN.ext`, so an added file never overwrites an existing one. */
export function nextMediaName(pkg: DocxPackage, extension: string): string {
  let highest = 0
  for (const path of pkg.parts.keys()) {
    const match = /^word\/media\/image(\d+)\./u.exec(path)
    if (match?.[1]) highest = Math.max(highest, Number.parseInt(match[1], 10))
  }
  return `image${String(highest + 1)}.${extension}`
}

/** Declares an extension in `[Content_Types].xml` if it is not there already. */
export function ensureContentType(pkg: DocxPackage, extension: string, contentType: string): void {
  const xml = getPartText(pkg, CONTENT_TYPES_PART)
  if (xml === undefined) return

  const roots = parseXml(xml)
  const types = roots.find((node) => tagName(node) === 'Types')
  if (!types) return

  const already = children(types).some(
    (node) =>
      tagName(node) === 'Default' &&
      attribute(node, 'Extension')?.toLowerCase() === extension.toLowerCase(),
  )
  if (already) return

  const list = types['Types']
  if (!Array.isArray(list)) return

  // Defaults come before Overrides in the schema; Word is strict about it.
  const firstOverride = (list as XmlNode[]).findIndex((node) => tagName(node) === 'Override')
  const declaration = element('Default', { Extension: extension, ContentType: contentType })
  const index = firstOverride === -1 ? list.length : firstOverride
  ;(list as XmlNode[]).splice(index, 0, declaration)

  setPartText(pkg, CONTENT_TYPES_PART, withDeclaration(buildXml(roots)))
}

export class UnsupportedImageError extends Error {
  override readonly name = 'UnsupportedImageError'
}

/**
 * Adds an image to the package and returns the relationship that points at it.
 */
export function addImage(pkg: DocxPackage, fileName: string, bytes: Uint8Array): AddedMedia {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  const contentType = contentTypeFor(fileName)

  if (contentType === null) {
    throw new UnsupportedImageError(
      `Word cannot embed ${extension === '' ? 'this file type' : `.${extension}`} images.`,
    )
  }

  const name = nextMediaName(pkg, extension)
  const path = `word/media/${name}`

  pkg.parts.set(path, { path, bytes, date: new Date() })
  ensureContentType(pkg, extension, contentType)

  const relationships = parseRelationships(getPartText(pkg, DOCUMENT_RELS_PART) ?? '')
  const relationship = addRelationship(relationships, IMAGE_RELATIONSHIP, `media/${name}`)
  setPartText(pkg, DOCUMENT_RELS_PART, serializeRelationships(relationships))

  return { relationshipId: relationship.id, path }
}

/** Data URL for a media part, so the webview can display it. */
export function mediaDataUrl(pkg: DocxPackage, path: string): string | null {
  const part = pkg.parts.get(path)
  if (!part) return null

  const contentType = contentTypeFor(path)
  if (contentType === null) return null

  let binary = ''
  for (const byte of part.bytes) binary += String.fromCharCode(byte)
  return `data:${contentType};base64,${btoa(binary)}`
}
