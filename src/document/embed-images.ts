import { decodeDataUrl } from './data-url'
import { addImage, UnsupportedImageError } from './media'
import { addPicture } from './odt-file'
import type { DocxPackage } from '../ooxml/package'
import type { OdtPackage } from './converters/odt'
import { contentWidth } from '../ooxml/section'
import type { SectionProperties } from '../ooxml/section'
import { fitWithin } from '../ooxml/image'
import type { ParseWarning, ProseMirrorNodeJson } from '../ooxml/parse-document'

/**
 * Moving pictures into a package.
 *
 * A document converted from another format carries its pictures as data URLs
 * and nothing else — no relationship, no media part. Writing it out means
 * putting the bytes in the package first: a drawing that names a relationship
 * the package does not have is a file Word offers to repair, and a frame
 * pointing at a missing part is a hole in the page.
 *
 * The two formats differ only in where the bytes go and what the node has to
 * say to find them again, which is what `store` decides.
 */

export interface EmbedResult {
  doc: ProseMirrorNodeJson
  warnings: ParseWarning[]
}

/** Size of a picture as it is stored, in points; the caller measures it. */
export type MeasureImage = (src: string) => Promise<{ width: number; height: number }>

/**
 * Puts the bytes in the package and returns what the node needs to find them.
 *
 * Throws when the package cannot hold that kind of picture, which the caller
 * turns into a warning.
 */
export type StoreImage = (bytes: Uint8Array, extension: string) => Record<string, unknown>

/**
 * Rewrites every picture in the document to point at part of a package.
 *
 * Markup preserved from the format the document came from is cleared: a
 * `draw:frame` read from an ODT describes nothing Word can use, and leaving it
 * in place would have the serializer write OpenDocument markup into
 * `document.xml`.
 */
export async function embedImages(
  doc: ProseMirrorNodeJson,
  store: StoreImage,
  options: { section: SectionProperties; measure?: MeasureImage },
): Promise<EmbedResult> {
  const warnings: ParseWarning[] = []
  const column = contentWidth(options.section)
  let nextId = 1

  const convert = async (node: ProseMirrorNodeJson): Promise<ProseMirrorNodeJson | null> => {
    if (node.type === 'image') {
      const src = node.attrs?.['src']
      const decoded = typeof src === 'string' ? decodeDataUrl(src) : null

      if (decoded === null) {
        warnings.push({
          tag: 'image',
          message:
            'A picture stored outside the document was left out, because a document file can only hold pictures it carries itself.',
        })
        return null
      }

      let stored: Record<string, unknown>
      try {
        stored = store(decoded.bytes, decoded.extension)
      } catch (error) {
        warnings.push({
          tag: 'image',
          message:
            error instanceof UnsupportedImageError
              ? error.message
              : `A picture could not be saved into the document: ${error instanceof Error ? error.message : String(error)}`,
        })
        return null
      }

      const width = node.attrs?.['width']
      const height = node.attrs?.['height']
      const known =
        typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0

      // A picture from Markdown or HTML may carry no size at all; measuring it
      // is the only way to avoid writing a drawing zero points wide.
      const natural = known
        ? { width, height }
        : ((await options.measure?.(typeof src === 'string' ? src : '')) ?? { width: 0, height: 0 })

      const size = fitWithin(natural, column)
      const id = nextId
      nextId += 1

      return {
        ...node,
        attrs: {
          ...node.attrs,
          // Preserved markup from the source format has no meaning here.
          relationshipId: null,
          drawing: null,
          drawingWidth: null,
          drawingWrap: null,
          frame: null,
          href: null,
          ...stored,
          width: size.width,
          height: size.height,
          imageId: id,
        },
      }
    }

    if (node.content === undefined) return node

    const content: ProseMirrorNodeJson[] = []
    for (const child of node.content) {
      const converted = await convert(child)
      if (converted !== null) content.push(converted)
    }

    return { ...node, content }
  }

  const converted = await convert(doc)
  return { doc: converted ?? doc, warnings }
}

/** Pictures into `word/media/`, named by the relationship that points at them. */
export function embedImagesInto(
  pkg: DocxPackage,
  doc: ProseMirrorNodeJson,
  options: { section: SectionProperties; measure?: MeasureImage },
): Promise<EmbedResult> {
  return embedImages(
    doc,
    (bytes, extension) => ({
      relationshipId: addImage(pkg, `image.${extension}`, bytes).relationshipId,
    }),
    options,
  )
}

/** Pictures into `Pictures/`, named by the path a frame refers to them by. */
export function embedOdtImages(
  pkg: OdtPackage,
  doc: ProseMirrorNodeJson,
  options: { section: SectionProperties; measure?: MeasureImage },
): Promise<EmbedResult> {
  return embedImages(doc, (bytes, extension) => ({ href: addPicture(pkg, extension, bytes) }), options)
}
