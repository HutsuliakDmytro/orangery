import {
  children,
  element,
  ensureChild,
  findChild,
  removeChild,
  setAttribute,
  tagName,
  upsertChild,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { Color, Fill, Shadow } from '@orangery/ooxml-drawingml'
import type { Shape } from './shape-tree'

/**
 * Changing how a shape looks, by patching its own properties.
 *
 * The rule that runs through reading these applies just as much to writing
 * them: absent is not the same as none. Clearing a fill writes `a:noFill`,
 * which says the shape is transparent; removing the element instead would send
 * it back to whatever its style reference gives it, which is a different shape
 * from the one the person asked for.
 */

/** `a:spPr` in schema order — the sequence PowerPoint checks on open. */
export const SHAPE_PROPERTIES = [
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
  'a:scene3d',
  'a:sp3d',
  'a:extLst',
]

/** `a:ln` children, which are their own sequence. */
const LINE = [
  'a:noFill',
  'a:solidFill',
  'a:gradFill',
  'a:pattFill',
  'a:prstDash',
  'a:custDash',
  'a:round',
  'a:bevel',
  'a:miter',
  'a:headEnd',
  'a:tailEnd',
]

const FILL_TAGS = ['a:noFill', 'a:solidFill', 'a:gradFill', 'a:blipFill', 'a:pattFill', 'a:grpFill']

/** The `p:spPr` a shape keeps its look in. */
export function propertiesOf(shape: Shape): XmlNode | undefined {
  return children(shape.node).find((child) => /^p:(sp|cxnSp)Pr$/u.test(tagName(child) ?? ''))
}

/** Builds the colour element for a solid fill or line. */
function colorElement(color: Color): XmlNode {
  const transforms = color.transforms.map((transform) =>
    element(`a:${transform.kind}`, { val: String(Math.round(transform.value * 100000)) }),
  )

  switch (color.source.kind) {
    case 'srgb':
      return element('a:srgbClr', { val: color.source.hex.replace('#', '') }, transforms)
    case 'scheme':
      return element('a:schemeClr', { val: color.source.name }, transforms)
    case 'system':
      return element(
        'a:sysClr',
        {
          val: color.source.name,
          ...(color.source.lastHex === null
            ? {}
            : { lastClr: color.source.lastHex.replace('#', '') }),
        },
        transforms,
      )
    case 'preset':
      return element('a:prstClr', { val: color.source.name }, transforms)
  }
}

/**
 * Builds `a:gradFill`.
 *
 * Positions are thousandths of a percent and the angle is 60000ths of a degree,
 * like every other ratio and angle in DrawingML. A radial gradient says so with
 * `a:path` instead of `a:lin`, and the rectangle it grows from is the middle of
 * the shape — the four edges given as percentages inward.
 */
function gradientElement(fill: Extract<Fill, { kind: 'gradient' }>): XmlNode | null {
  const stops = fill.stops.flatMap((stop) =>
    stop.color === null
      ? []
      : [
          element('a:gs', { pos: String(Math.round(stop.position * 100000)) }, [
            colorElement(stop.color),
          ]),
        ],
  )
  if (stops.length < 2) return null

  const direction = fill.radial
    ? element('a:path', { path: 'circle' }, [
        element('a:fillToRect', { l: '50000', t: '50000', r: '50000', b: '50000' }),
      ])
    : element('a:lin', { ang: String(Math.round(fill.angle ?? 0)), scaled: '0' })

  return element('a:gradFill', { rotWithShape: '1' }, [element('a:gsLst', {}, stops), direction])
}

/** The element for a fill we can write. Pictures are inserted, not written here. */
function fillElement(fill: Fill): XmlNode | null {
  switch (fill.kind) {
    case 'none':
      return element('a:noFill')
    case 'solid':
      return fill.color === null ? null : element('a:solidFill', {}, [colorElement(fill.color)])
    case 'gradient':
      return gradientElement(fill)
    default:
      return null
  }
}

/** Replaces whatever fill a container states. */
export function setFill(container: XmlNode, fill: Fill, order: readonly string[]): boolean {
  const written = fillElement(fill)
  if (written === null) return false

  for (const tag of FILL_TAGS) removeChild(container, tag)
  upsertChild(container, written, order)
  return true
}

export function writeFill(shape: Shape, fill: Fill): boolean {
  const properties = propertiesOf(shape)
  return properties === undefined ? false : setFill(properties, fill, SHAPE_PROPERTIES)
}

export interface LineChange {
  /** The stroke colour, or a fill of none to remove the outline. */
  fill?: Fill
  /** Width in EMU. */
  width?: number
  /** `a:prstDash` value, or null to clear it. */
  dash?: string | null
}

/**
 * Changes a line, creating `a:ln` when the shape has none.
 *
 * Only what is named changes: setting a width leaves the colour alone, which is
 * how a properties panel is expected to behave.
 */
export function writeLine(shape: Shape, change: LineChange): boolean {
  const properties = propertiesOf(shape)
  if (properties === undefined) return false

  const existing = children(properties).find((child) => tagName(child) === 'a:ln')
  const line = existing ?? element('a:ln')
  let changed = false

  if (change.width !== undefined) {
    setAttribute(line, 'w', String(Math.round(change.width)))
    changed = true
  }

  if (change.fill !== undefined && setFill(line, change.fill, LINE)) changed = true

  if (change.dash !== undefined) {
    removeChild(line, 'a:prstDash')
    if (change.dash !== null) {
      upsertChild(line, element('a:prstDash', { val: change.dash }), LINE)
    }
    changed = true
  }

  if (changed) upsertChild(properties, line, SHAPE_PROPERTIES)
  return changed
}

/**
 * The drop shadow a shape states, or none at all.
 *
 * Written into `a:effectLst`, which is where every other effect lives too — so
 * the list is made if it is missing and left alone if it holds anything else. A
 * shape given a shadow and then taken back to none loses its `a:outerShdw` and
 * keeps its glow, which is the only behaviour that does not quietly throw away
 * something nobody mentioned.
 */
export function writeShadow(shape: Shape, shadow: Shadow | null): boolean {
  const properties = propertiesOf(shape)
  if (properties === undefined) return false

  if (shadow === null) {
    const list = findChild(properties, 'a:effectLst')
    if (list === undefined) return false

    removeChild(list, 'a:outerShdw')
    // An empty list says nothing; leaving it would be stating "no effects",
    // which is a different answer from not saying.
    if (children(list).length === 0) removeChild(properties, 'a:effectLst')
    return true
  }

  // After the fill and the line, before the 3-D, which is the schema's order.
  const list = ensureChild(properties, 'a:effectLst', SHAPE_PROPERTIES)
  removeChild(list, 'a:outerShdw')

  const shadowElement = element('a:outerShdw', {
    blurRad: String(Math.round(shadow.blur)),
    dist: String(Math.round(shadow.distance)),
    dir: String(Math.round(shadow.direction)),
    rotWithShape: '0',
  })

  if (shadow.color !== null) children(shadowElement).push(colorElement(shadow.color))
  children(list).unshift(shadowElement)
  return true
}
