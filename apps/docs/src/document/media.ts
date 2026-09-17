import {
  CONTENT_TYPES_PART,
  IMAGE_RELATIONSHIP,
  addRelationship,
  attribute,
  buildXml,
  children,
  element,
  getPartText,
  parseRelationships,
  parseXml,
  serializeRelationships,
  setPartText,
  tagName,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { contentTypeFor } from '@orangery/ooxml-drawingml'
import { dataUrlFrom } from './data-url'

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
export function nextMediaName(pkg: OoxmlPackage, extension: string): string {
  let highest = 0
  for (const path of pkg.parts.keys()) {
    const match = /^word\/media\/image(\d+)\./u.exec(path)
    if (match?.[1]) highest = Math.max(highest, Number.parseInt(match[1], 10))
  }
  return `image${String(highest + 1)}.${extension}`
}

/** Declares an extension in `[Content_Types].xml` if it is not there already. */
export function ensureContentType(pkg: OoxmlPackage, extension: string, contentType: string): void {
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

/** The message shown when a picture is of a kind no document format can hold. */
export function unsupportedImageMessage(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return `A document cannot hold ${extension === '' || extension === fileName.toLowerCase() ? 'this file type' : `.${extension}`} images.`
}

/**
 * Adds an image to the package and returns the relationship that points at it.
 */
export function addImage(pkg: OoxmlPackage, fileName: string, bytes: Uint8Array): AddedMedia {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  const contentType = contentTypeFor(fileName)

  if (contentType === null) throw new UnsupportedImageError(unsupportedImageMessage(fileName))

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
export function mediaDataUrl(pkg: OoxmlPackage, path: string): string | null {
  const part = pkg.parts.get(path)
  return part === undefined ? null : dataUrlFrom(part.bytes, path)
}

/** How long to wait for a picture to report its size before giving up. */
const MEASURE_TIMEOUT_MS = 2000

/**
 * The natural size of a picture, in points at 96 dpi.
 *
 * Resolves to zeroes rather than rejecting when the picture cannot be read, and
 * gives up after a moment: a malformed data URL fires neither event, and a save
 * must not hang on one.
 */
export function naturalSize(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const unknown = { width: 0, height: 0 }

    if (typeof Image !== 'function') {
      resolve(unknown)
      return
    }

    const timer = setTimeout(() => {
      resolve(unknown)
    }, MEASURE_TIMEOUT_MS)

    const settle = (size: { width: number; height: number }) => {
      clearTimeout(timer)
      resolve(size)
    }

    const image = new Image()
    image.onload = () => {
      settle({ width: image.naturalWidth * (72 / 96), height: image.naturalHeight * (72 / 96) })
    }
    image.onerror = () => {
      settle(unknown)
    }
    image.src = dataUrl
  })
}
