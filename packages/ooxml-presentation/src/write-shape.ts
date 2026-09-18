import {
  children,
  ensureChild,
  element,
  removeAttribute,
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
