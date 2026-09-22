import { IMAGE_RELATIONSHIP, addMedia } from '@orangery/ooxml-core'
import { documentRelsPart } from '../ooxml/parts'
import type { AddedMedia, OoxmlPackage } from '@orangery/ooxml-core'
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

/**
 * Where a document that was written the usual way keeps its relationships.
 *
 * Kept for a package being built rather than read. For one that was read, ask
 * `documentRelsPart(pkg)`: the rels file's name follows the document part's,
 * and that part is whatever `_rels/.rels` says it is.
 */
export const CONVENTIONAL_DOCUMENT_RELS_PART = 'word/_rels/document.xml.rels'

export class UnsupportedImageError extends Error {
  override readonly name = 'UnsupportedImageError'
}

/** The message shown when a picture is of a kind no document format can hold. */
export function unsupportedImageMessage(fileName: string): string {
  const extension = fileName.split('.').pop()?.toLowerCase() ?? ''
  return `A document cannot hold ${extension === '' || extension === fileName.toLowerCase() ? 'this file type' : `.${extension}`} images.`
}

/** Where a document keeps its media, and which rels file points at it. */
const MEDIA_DIRECTORY = 'word/media'

/**
 * Adds an image to the package and returns the relationship that points at it.
 *
 * The package work — the bytes, the content type, the relationship — is the
 * same in every OOXML format and lives in `@orangery/ooxml-core`. What is here
 * is where a document puts them, and which images it will accept.
 */
export function addImage(pkg: OoxmlPackage, fileName: string, bytes: Uint8Array): AddedMedia {
  const contentType = contentTypeFor(fileName)
  if (contentType === null) throw new UnsupportedImageError(unsupportedImageMessage(fileName))

  return addMedia(pkg, {
    directory: MEDIA_DIRECTORY,
    relsPart: documentRelsPart(pkg),
    relationshipType: IMAGE_RELATIONSHIP,
    fileName,
    contentType,
    bytes,
  })
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
