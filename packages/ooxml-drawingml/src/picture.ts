import { attribute, element, findChild, findDescendant } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * A picture in DrawingML.
 *
 * `pic:pic` is the same element wherever it appears — inside a document's
 * `w:drawing`, inside a deck's shape tree, inside a `graphicFrame`. What
 * differs is the wrapper around it and how it is positioned, and that belongs
 * to whichever format owns the wrapper.
 *
 * The picture itself carries no bytes: `a:blip` holds a relationship id, and
 * the part it points at lives in the package.
 */

const DRAWINGML_NS = 'http://schemas.openxmlformats.org/drawingml/2006/main'
const PICTURE_NS = 'http://schemas.openxmlformats.org/drawingml/2006/picture'
const RELATIONSHIPS_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

/** The relationship id of the image a drawing shows, or null if it has none. */
export function blipRelationshipId(node: XmlNode): string | null {
  const blip = findDescendant(node, 'a:blip')
  if (blip === undefined) return null

  return attribute(blip, 'r:embed') ?? null
}

export interface Picture {
  /** Relationship id of the media part, resolved by the caller. */
  relationshipId: string
  /** Shape id, unique within the part it is written into. */
  id: number
  /** Shown in the accessibility pane and the selection list. */
  name: string
  /** Extent in EMU. */
  width: number
  height: number
}

/**
 * Builds the `a:graphic` that embeds a picture.
 *
 * This is the form used when a drawing is hosted by another format — a
 * `w:drawing` in a document, a `graphicFrame` in a deck. It describes a plain
 * stretched picture with a rectangular frame: no crop, no effects. A picture
 * read from a file keeps its original markup instead of being rebuilt through
 * here, so nothing this does not model is lost by passing through it.
 */
export function pictureGraphic(picture: Picture): XmlNode {
  const cx = String(picture.width)
  const cy = String(picture.height)

  return element('a:graphic', { 'xmlns:a': DRAWINGML_NS }, [
    element('a:graphicData', { uri: PICTURE_NS }, [
      element('pic:pic', { 'xmlns:pic': PICTURE_NS }, [
        element('pic:nvPicPr', {}, [
          element('pic:cNvPr', { id: String(picture.id), name: picture.name }),
          element('pic:cNvPicPr'),
        ]),
        element('pic:blipFill', {}, [
          element('a:blip', {
            'xmlns:r': RELATIONSHIPS_NS,
            'r:embed': picture.relationshipId,
          }),
          element('a:stretch', {}, [element('a:fillRect')]),
        ]),
        element('pic:spPr', {}, [
          element('a:xfrm', {}, [
            element('a:off', { x: '0', y: '0' }),
            element('a:ext', { cx, cy }),
          ]),
          element('a:prstGeom', { prst: 'rect' }, [element('a:avLst')]),
        ]),
      ]),
    ]),
  ])
}

/**
 * How much of the image is shown, as a fraction cropped from each side.
 *
 * `a:srcRect` is written in thousandths of a percent, and every side is
 * optional — a picture cropped only on the left states only `l`. Zero from
 * every side is the whole image.
 */
export interface Crop {
  left: number
  top: number
  right: number
  bottom: number
}

export const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 }

export interface BlipFill {
  /** Relationship id of the media part, or null for a fill that links out. */
  relationshipId: string | null
  crop: Crop
  /** `stretch` fills the shape, `tile` repeats. */
  mode: 'stretch' | 'tile' | null
}

const fraction = (value: string | undefined): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed / 100000 : 0
}

/** Reads `p:blipFill` or `a:blipFill`. */
export function readBlipFill(node: XmlNode): BlipFill {
  const source = findChild(node, 'a:srcRect')

  return {
    relationshipId: blipRelationshipId(node),
    crop:
      source === undefined
        ? NO_CROP
        : {
            left: fraction(attribute(source, 'l')),
            top: fraction(attribute(source, 't')),
            right: fraction(attribute(source, 'r')),
            bottom: fraction(attribute(source, 'b')),
          },
    mode:
      findChild(node, 'a:tile') !== undefined
        ? 'tile'
        : findChild(node, 'a:stretch') !== undefined
          ? 'stretch'
          : null,
  }
}
