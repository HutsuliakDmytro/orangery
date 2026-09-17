import {
  addMedia,
  children,
  element,
  IMAGE_RELATIONSHIP,
  partDirectory,
} from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { contentTypeFor } from '@orangery/ooxml-drawingml'
import { nextShapeId } from './arrange'
import type { SlidePart } from './deck'

/**
 * Putting a picture on a slide.
 *
 * Four things change together, and a deck missing any of them makes PowerPoint
 * offer to repair it: the bytes, the content type, a relationship from *this
 * slide* — each slide has its own rels file, unlike a document, which has one —
 * and the `p:pic` that points at the relationship.
 */

export class UnsupportedPictureError extends Error {
  override readonly name = 'UnsupportedPictureError'
}

export interface NewPicture {
  fileName: string
  bytes: Uint8Array
  /** In EMU. */
  transform: { x: number; y: number; width: number; height: number }
  /** Alt text, which is the only description a picture carries. */
  description?: string
}

/** The rels file belonging to a part. */
export function relsPartFor(path: string): string {
  const directory = partDirectory(path)
  const name = path.slice(directory.length + 1)
  return `${directory}/_rels/${name}.rels`
}

export function insertPicture(pkg: OoxmlPackage, part: SlidePart, picture: NewPicture): number {
  const contentType = contentTypeFor(picture.fileName)
  if (contentType === null) {
    throw new UnsupportedPictureError(`A deck cannot hold ${picture.fileName} pictures.`)
  }

  const added = addMedia(pkg, {
    directory: 'ppt/media',
    relsPart: relsPartFor(part.path),
    relationshipType: IMAGE_RELATIONSHIP,
    fileName: picture.fileName,
    contentType,
    bytes: picture.bytes,
  })

  const id = nextShapeId(part)
  const round = (value: number) => String(Math.round(value))

  const node = element('p:pic', {}, [
    element('p:nvPicPr', {}, [
      element('p:cNvPr', {
        id: String(id),
        name: `Picture ${String(id)}`,
        ...(picture.description === undefined ? {} : { descr: picture.description }),
      }),
      // Locked aspect ratio, which is what PowerPoint sets on an inserted
      // picture: resizing from a corner keeps it undistorted.
      element('p:cNvPicPr', {}, [element('a:picLocks', { noChangeAspect: '1' })]),
      element('p:nvPr'),
    ]),
    element('p:blipFill', {}, [
      element('a:blip', { 'r:embed': added.relationshipId }),
      element('a:stretch', {}, [element('a:fillRect')]),
    ]),
    element('p:spPr', {}, [
      element('a:xfrm', {}, [
        element('a:off', { x: round(picture.transform.x), y: round(picture.transform.y) }),
        element('a:ext', {
          cx: round(Math.max(picture.transform.width, 0)),
          cy: round(Math.max(picture.transform.height, 0)),
        }),
      ]),
      element('a:prstGeom', { prst: 'rect' }, [element('a:avLst')]),
    ]),
  ])

  children(part.tree).push(node)
  return id
}
