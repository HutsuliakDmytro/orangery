import {
  attribute,
  children,
  element,
  findChild,
  parseIntAttribute,
  serializeNode,
  tagName,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import {
  blipRelationshipId,
  emuToPoints,
  pictureGraphic,
  pointsToEmu,
} from '@orangery/ooxml-drawingml'
import type { ProseMirrorNodeJson } from './prosemirror-json'

/**
 * How a document hosts a picture — `w:drawing`, `wp:inline`, `wp:anchor`.
 *
 * The picture itself is DrawingML and is shared with the rest of the suite;
 * everything here is the wrapper WordprocessingML puts around it, which decides
 * where on the page it sits and how text flows past it. A deck has no such
 * wrapper — a shape carries its own position — so none of this is shared.
 *
 * Floating images whose wrap style we cannot reproduce are preserved as
 * passthrough rather than approximated as inline: an image that silently moves
 * into the text flow is a worse outcome than one that cannot be resized yet.
 */

/**
 * How text flows around a floating image.
 *
 * OOXML has five wrap elements; these are the ones with a faithful CSS
 * equivalent. `wrapNone` — the image behind or in front of the text — has none,
 * so it stays passthrough rather than being flattened into the flow, which
 * would move it on the page.
 */
export type ImageWrap = 'inline' | 'left' | 'right' | 'topAndBottom'

const WRAP_ELEMENTS = new Set(['wp:wrapSquare', 'wp:wrapTight', 'wp:wrapThrough'])

/** Reads the wrap style of an anchored drawing, or null when we cannot model it. */
export function parseWrap(anchor: XmlNode): ImageWrap | null {
  for (const child of children(anchor)) {
    const tag = tagName(child)

    if (tag === 'wp:wrapTopAndBottom') return 'topAndBottom'

    if (tag !== null && WRAP_ELEMENTS.has(tag)) {
      // `wrapText` says which side text may occupy, which is the opposite of the
      // side the image floats to.
      const wrapText = attribute(child, 'wrapText')
      if (wrapText === 'left') return 'right'
      if (wrapText === 'right') return 'left'

      // `bothSides` and `largest` have no CSS equivalent; Word lays the image
      // where the offset puts it. Falling back to the horizontal alignment is
      // closer than guessing.
      return horizontalAlignment(anchor) ?? 'left'
    }
  }

  return null
}

function horizontalAlignment(anchor: XmlNode): ImageWrap | null {
  const positionH = findChild(anchor, 'wp:positionH')
  if (!positionH) return null

  const align = findChild(positionH, 'wp:align')
  if (!align) return null

  const value = children(align)
    .map((node) => ('#text' in node ? String(node['#text']) : ''))
    .join('')

  return value === 'right' ? 'right' : value === 'left' ? 'left' : null
}

export interface ImageAttributes {
  /** Relationship id, resolved to a media part by the caller. */
  relationshipId: string
  width: number
  height: number
  alt: string
  wrap: ImageWrap
  /** The original `w:drawing`, so an untouched image round-trips exactly. */
  drawing: string
}

/**
 * Reads a picture from a drawing.
 *
 * Handles both the inline form and the anchored form whose wrap style we can
 * reproduce; anything else returns null and is preserved verbatim.
 */
export function parseDrawing(drawing: XmlNode): ImageAttributes | null {
  const inline = findChild(drawing, 'wp:inline')
  const anchor = inline ? undefined : findChild(drawing, 'wp:anchor')

  const container = inline ?? anchor
  if (!container) return null

  const wrap: ImageWrap | null = inline ? 'inline' : parseWrap(anchor as XmlNode)
  if (wrap === null) return null

  const extent = findChild(container, 'wp:extent')
  const relationshipId = blipRelationshipId(container)
  if (relationshipId === null) return null

  const docPr = findChild(container, 'wp:docPr')
  const width = parseIntAttribute(extent === undefined ? undefined : attribute(extent, 'cx'))
  const height = parseIntAttribute(extent === undefined ? undefined : attribute(extent, 'cy'))

  return {
    relationshipId,
    width: width === null ? 0 : emuToPoints(width),
    height: height === null ? 0 : emuToPoints(height),
    alt: (docPr === undefined ? undefined : attribute(docPr, 'descr')) ?? '',
    wrap,
    drawing: serializeNode(drawing),
  }
}

/**
 * Builds a `w:drawing` for a newly inserted image.
 *
 * Used only for images the editor adds — an image read from a file keeps its
 * original drawing XML, which carries picture effects and cropping this does
 * not reproduce.
 */
export function buildDrawing(image: {
  relationshipId: string
  width: number
  height: number
  alt: string
  id: number
  wrap?: ImageWrap
}): XmlNode {
  const cx = String(pointsToEmu(image.width))
  const cy = String(pointsToEmu(image.height))
  const name = `Picture ${String(image.id)}`

  // The picture is identical in both forms; only the wrapper that places it
  // on the page differs.
  const picture = pictureGraphic({
    relationshipId: image.relationshipId,
    id: image.id,
    name,
    width: pointsToEmu(image.width),
    height: pointsToEmu(image.height),
  })

  if (image.wrap !== undefined && image.wrap !== 'inline') {
    return element('w:drawing', {}, [
      element(
        'wp:anchor',
        {
          distT: '0',
          distB: '0',
          distL: '114300',
          distR: '114300',
          simplePos: '0',
          relativeHeight: '251658240',
          behindDoc: '0',
          locked: '0',
          layoutInCell: '1',
          allowOverlap: '1',
        },
        [
          element('wp:simplePos', { x: '0', y: '0' }),
          element('wp:positionH', { relativeFrom: 'column' }, [
            element('wp:align', {}, [
              {
                '#text':
                  image.wrap === 'right' ? 'right' : image.wrap === 'left' ? 'left' : 'center',
              },
            ]),
          ]),
          element('wp:positionV', { relativeFrom: 'paragraph' }, [
            element('wp:posOffset', {}, [{ '#text': '0' }]),
          ]),
          element('wp:extent', { cx, cy }),
          element('wp:effectExtent', { l: '0', t: '0', r: '0', b: '0' }),
          image.wrap === 'topAndBottom'
            ? element('wp:wrapTopAndBottom')
            : // `wrapText` names the side text may occupy, which is the opposite
              // of the side the image sits on.
              element('wp:wrapSquare', { wrapText: image.wrap === 'left' ? 'right' : 'left' }),
          element('wp:docPr', {
            id: String(image.id),
            name,
            ...(image.alt === '' ? {} : { descr: image.alt }),
          }),
          element('wp:cNvGraphicFramePr', {}, [
            element('a:graphicFrameLocks', {
              'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
              noChangeAspect: '1',
            }),
          ]),
          picture,
        ],
      ),
    ])
  }

  return element('w:drawing', {}, [
    element('wp:inline', { distT: '0', distB: '0', distL: '0', distR: '0' }, [
      element('wp:extent', { cx, cy }),
      element('wp:effectExtent', { l: '0', t: '0', r: '0', b: '0' }),
      element('wp:docPr', {
        id: String(image.id),
        name,
        ...(image.alt === '' ? {} : { descr: image.alt }),
      }),
      element('wp:cNvGraphicFramePr', {}, [
        element('a:graphicFrameLocks', {
          'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
          noChangeAspect: '1',
        }),
      ]),
      picture,
    ]),
  ])
}

/** The ProseMirror node for a parsed image. */
export function imageNode(image: ImageAttributes, src: string): ProseMirrorNodeJson {
  return {
    type: 'image',
    attrs: {
      src,
      alt: image.alt,
      width: image.width,
      height: image.height,
      relationshipId: image.relationshipId,
      wrap: image.wrap,
      // Kept so an image nobody touched is written back byte for byte. The
      // recorded width and wrap tell the serialiser whether either changed.
      drawing: image.drawing,
      drawingWidth: image.width,
      drawingWrap: image.wrap,
    },
  }
}
