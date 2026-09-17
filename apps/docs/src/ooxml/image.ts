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
import type { ProseMirrorNodeJson } from './prosemirror-json'

/**
 * Inline images — `w:drawing` / `wp:inline`.
 *
 * DrawingML measures in EMUs (English Metric Units), 914400 per inch, chosen so
 * that both inches and centimetres divide evenly. The picture itself is a
 * relationship id pointing at a part under `word/media/`; the drawing carries
 * only the id and the display size.
 *
 * Floating images (`wp:anchor`, text wrapping) are a separate shape and are
 * preserved as passthrough rather than approximated as inline — an image that
 * silently moves into the text flow is a worse outcome than one that cannot be
 * resized yet.
 */

export const EMU_PER_INCH = 914400
export const EMU_PER_POINT = EMU_PER_INCH / 72

export function emuToPoints(emu: number): number {
  return Math.round((emu / EMU_PER_POINT) * 100) / 100
}

export function pointsToEmu(points: number): number {
  return Math.round(points * EMU_PER_POINT)
}

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

function findDescendant(node: XmlNode, tag: string): XmlNode | undefined {
  for (const child of children(node)) {
    if (tagName(child) === tag) return child
    const nested = findDescendant(child, tag)
    if (nested) return nested
  }
  return undefined
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
  const blip = findDescendant(container, 'a:blip')
  const relationshipId = blip === undefined ? undefined : attribute(blip, 'r:embed')
  if (relationshipId === undefined) return null

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
          buildGraphic(image, cx, cy, name),
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
      buildGraphic(image, cx, cy, name),
    ]),
  ])
}

/** The picture itself, shared by the inline and anchored forms. */
function buildGraphic(
  image: { relationshipId: string; id: number },
  cx: string,
  cy: string,
  name: string,
): XmlNode {
  return element(
    'a:graphic',
    { 'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main' },
    [
      element(
        'a:graphicData',
        { uri: 'http://schemas.openxmlformats.org/drawingml/2006/picture' },
        [
          element(
            'pic:pic',
            { 'xmlns:pic': 'http://schemas.openxmlformats.org/drawingml/2006/picture' },
            [
              element('pic:nvPicPr', {}, [
                element('pic:cNvPr', { id: String(image.id), name }),
                element('pic:cNvPicPr'),
              ]),
              element('pic:blipFill', {}, [
                element('a:blip', {
                  'xmlns:r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
                  'r:embed': image.relationshipId,
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
            ],
          ),
        ],
      ),
    ],
  )
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

/** Content type for a media part, from its extension. */
export function contentTypeFor(fileName: string): string | null {
  const extension = fileName.split('.').pop()?.toLowerCase()
  switch (extension) {
    case 'png':
      return 'image/png'
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg'
    case 'gif':
      return 'image/gif'
    case 'bmp':
      return 'image/bmp'
    case 'svg':
      return 'image/svg+xml'
    case 'webp':
      return 'image/webp'
    case 'tif':
    case 'tiff':
      return 'image/tiff'
    default:
      return null
  }
}

/** Scales an image down to fit the text column, as Word does on insert. */
export function fitWithin(
  natural: { width: number; height: number },
  maxWidth: number,
): { width: number; height: number } {
  if (natural.width <= 0 || natural.height <= 0) return { width: maxWidth, height: maxWidth }
  if (natural.width <= maxWidth) return natural

  const scale = maxWidth / natural.width
  return {
    width: Math.round(maxWidth * 100) / 100,
    height: Math.round(natural.height * scale * 100) / 100,
  }
}
