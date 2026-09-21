import { attribute, children, findChild } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { readColorChild } from './color'
import type { Color } from './color'

/**
 * The drop shadow a shape carries.
 *
 * `a:effectLst` holds a good deal more than this — glows, reflections, soft
 * edges, three-dimensional bevels — and all of it is preserved on save whether
 * or not anything here reads it. What is read is the one effect that changes
 * whether a slide looks like the slide somebody made: a shape with a shadow
 * drawn flat sits on the page instead of above it, and on a deck where every
 * box has one, that is the whole design gone.
 */

export interface Shadow {
  /** How far the shadow is offset, in EMU. */
  distance: number
  /** Which way, in sixtieth-thousandths of a degree, clockwise from east. */
  direction: number
  /** Blur radius in EMU. */
  blur: number
  color: Color | null
}

/** Reads the outer shadow of a shape's properties, or null when it has none. */
export function readShadow(properties: XmlNode): Shadow | null {
  const list = findChild(properties, 'a:effectLst')
  const shadow = list === undefined ? undefined : findChild(list, 'a:outerShdw')
  if (shadow === undefined) return null

  const number = (name: string, fallback: number) => {
    const value = Number(attribute(shadow, name))
    return Number.isFinite(value) ? value : fallback
  }

  return {
    distance: number('dist', 0),
    direction: number('dir', 0),
    blur: number('blurRad', 0),
    color: readColorChild(shadow),
  }
}

/** Whether a properties element states any effect at all. */
export function hasAnyEffect(properties: XmlNode): boolean {
  const list = findChild(properties, 'a:effectLst')
  return list !== undefined && children(list).length > 0
}

/**
 * The shadow's offset in EMU, as x and y.
 *
 * DrawingML gives a distance and an angle; SVG wants two numbers. The angle is
 * clockwise from east and grows downwards, which is the same direction the y
 * axis grows in, so neither is negated.
 */
export function shadowOffset(shadow: Shadow): { x: number; y: number } {
  const radians = (shadow.direction / 60000) * (Math.PI / 180)
  return {
    x: Math.round(Math.cos(radians) * shadow.distance),
    y: Math.round(Math.sin(radians) * shadow.distance),
  }
}
