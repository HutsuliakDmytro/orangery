import {
  children,
  ensureChild,
  element,
  findChild,
  removeAttribute,
  removeChild,
  setAttribute,
  tagName,
  upsertChild,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { Shape, Transform } from './shape-tree'

/**
 * Editing a shape by patching the XML it came from.
 *
 * This is where ADR 0002 stops being a plan. The shape is not rebuilt from the
 * model — its own subtree is changed in place, so its effects, 3-D, geometry
 * adjustments and extension lists survive an edit to something else entirely.
 *
 * The failure mode the ADR warns about lives here too: a property that the
 * model reads and nothing writes saves nothing, quietly. Every writer needs a
 * test that edits, saves, reopens and reads back — not one that only checks the
 * XML it produced.
 */

/** `a:spPr` in schema order. An element out of place makes PowerPoint offer to repair. */
const SHAPE_PROPERTIES = [
  'a:xfrm',
  'a:custGeom',
  'a:prstGeom',
  'a:noFill',
  'a:solidFill',
  'a:gradFill',
  'a:blipFill',
  'a:pattFill',
  'a:grpFill',
  'a:ln',
  'a:effectLst',
  'a:effectDag',
  'a:scene3d',
  'a:sp3d',
  'a:extLst',
]

/** `a:xfrm` children, which are a sequence like everything else. */
const TRANSFORM = ['a:off', 'a:ext', 'a:chOff', 'a:chExt']

/** Where a shape of this kind keeps its geometry. */
function transformHolder(shape: Shape): XmlNode | null {
  if (shape.kind === 'graphicFrame') {
    // A graphic frame states a `p:xfrm` of its own rather than an `a:xfrm`
    // inside shape properties.
    return ensureChild(shape.node, 'p:xfrm', ['p:nvGraphicFramePr', 'p:xfrm', 'a:graphic'])
  }

  const properties = children(shape.node).find((child) =>
    /^p:(sp|grpSp|cxnSp)Pr$/u.test(tagName(child) ?? ''),
  )
  if (properties === undefined) return null

  return ensureChild(properties, 'a:xfrm', SHAPE_PROPERTIES)
}

/**
 * Writes a transform into the shape's own XML.
 *
 * Rotation and the flips are removed when they are back to nothing rather than
 * written as zero: PowerPoint omits them, and a file full of `rot="0"` is a
 * file that differs from the one it was opened as.
 */
export function writeTransform(shape: Shape, transform: Transform): boolean {
  const holder = transformHolder(shape)
  if (holder === null) return false

  upsertChild(
    holder,
    element('a:off', { x: String(Math.round(transform.x)), y: String(Math.round(transform.y)) }),
    TRANSFORM,
  )
  upsertChild(
    holder,
    element('a:ext', {
      cx: String(Math.round(transform.width)),
      cy: String(Math.round(transform.height)),
    }),
    TRANSFORM,
  )

  if (transform.rotation === 0) removeAttribute(holder, 'rot')
  else setAttribute(holder, 'rot', String(Math.round(transform.rotation)))

  for (const [flag, on] of [
    ['flipH', transform.flipHorizontal],
    ['flipV', transform.flipVertical],
  ] as const) {
    if (on) setAttribute(holder, flag, '1')
    else removeAttribute(holder, flag)
  }

  return true
}

/** Moves a shape by a distance in EMU, keeping its size. */
export function moveShape(shape: Shape, by: { x: number; y: number }): boolean {
  if (shape.transform === null) return false

  return writeTransform(shape, {
    ...shape.transform,
    x: shape.transform.x + by.x,
    y: shape.transform.y + by.y,
  })
}

/** `p:sp` in schema order; the text body comes last. */
const SHAPE = ['p:nvSpPr', 'p:spPr', 'p:style', 'p:txBody']

/** `p:cxnSp` has the same shape with its own non-visual element. */
const CONNECTOR = ['p:nvCxnSpPr', 'p:spPr', 'p:style', 'p:txBody']

/**
 * Gives a shape somewhere to put text, if it can hold any.
 *
 * A `p:sp` may state no text body at all, and one drawn elsewhere often does.
 * Entering it has to make one first — an empty `a:p` and nothing else, so the
 * shape inherits every bit of its styling from the placeholder or the theme
 * rather than freezing today's answer into the file.
 *
 * A picture and a graphic frame are left alone: PowerPoint will not put text in
 * them either, and a text body there is a file that does not open.
 */
export function ensureTextBody(shape: Shape): boolean {
  if (shape.text !== null) return false
  if (shape.kind !== 'sp' && shape.kind !== 'cxnSp') return false

  upsertChild(
    shape.node,
    element('p:txBody', {}, [
      element('a:bodyPr', { rtlCol: '0' }),
      element('a:lstStyle'),
      element('a:p'),
    ]),
    shape.kind === 'sp' ? SHAPE : CONNECTOR,
  )
  return true
}

/**
 * How much of a picture is hidden on each side, as fractions from 0 to 1.
 *
 * `a:srcRect` counts in thousandths of a percent, which is a hundred thousand
 * to the whole image; every side is optional and absent means nothing cropped.
 * A side cropped to nothing is removed rather than written as zero, so a
 * picture cropped and then uncropped is the picture it was.
 */
export function writeCrop(
  shape: Shape,
  crop: { left: number; top: number; right: number; bottom: number },
): boolean {
  const fill = findChild(shape.node, 'p:blipFill') ?? findChild(shape.node, 'a:blipFill')
  if (fill === undefined) return false

  const sides = [
    ['l', crop.left],
    ['t', crop.top],
    ['r', crop.right],
    ['b', crop.bottom],
  ] as const

  // Nothing cropped at all: the element goes, rather than sitting there saying
  // zero four times.
  if (sides.every(([, value]) => Math.round(value * 100000) === 0)) {
    removeChild(fill, 'a:srcRect')
    return true
  }

  // Before the stretch or the tile, which is where the schema puts it.
  const source = ensureChild(fill, 'a:srcRect', ['a:srcRect', 'a:stretch', 'a:tile'])
  for (const [name, value] of sides) {
    const thousandths = Math.round(Math.min(Math.max(value, 0), 1) * 100000)
    if (thousandths === 0) removeAttribute(source, name)
    else setAttribute(source, name, String(thousandths))
  }

  return true
}

/**
 * How see-through a picture is, from 0 to 1.
 *
 * `a:alphaModFix` states what is left rather than what was taken away, and a
 * blip that says nothing is opaque — so setting it back to 1 removes the
 * element rather than writing "100%", and a picture made transparent and put
 * back is the picture it was.
 */
export function writePictureOpacity(shape: Shape, opacity: number): boolean {
  const fill = findChild(shape.node, 'p:blipFill') ?? findChild(shape.node, 'a:blipFill')
  const blip = fill === undefined ? undefined : findChild(fill, 'a:blip')
  if (blip === undefined) return false

  const clamped = Math.min(Math.max(opacity, 0), 1)
  if (clamped >= 1) {
    removeChild(blip, 'a:alphaModFix')
    return true
  }

  const element = ensureChild(blip, 'a:alphaModFix', ['a:alphaModFix'])
  setAttribute(element, 'amt', String(Math.round(clamped * 100000)))
  return true
}

/**
 * Points a picture at different bytes, keeping everything else about it.
 *
 * The frame, the crop, the transparency and whatever else the shape carries
 * stay exactly as they were — replacing a picture is not drawing a new one, and
 * somebody who has spent a minute placing and cropping one does not want that
 * minute back.
 */
export function replacePicture(shape: Shape, relationshipId: string): boolean {
  const fill = findChild(shape.node, 'p:blipFill') ?? findChild(shape.node, 'a:blipFill')
  const blip = fill === undefined ? undefined : findChild(fill, 'a:blip')
  if (blip === undefined) return false

  setAttribute(blip, 'r:embed', relationshipId)
  return true
}
