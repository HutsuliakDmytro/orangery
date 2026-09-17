import { children, element } from '@orangery/ooxml-core'
import { nextShapeId } from './arrange'
import type { SlidePart } from './deck'
import type { Shape, Transform } from './shape-tree'

/**
 * Joining two shapes with a connector.
 *
 * A connector states two things that have to agree: its own transform, which
 * is where the line is drawn, and which shapes its ends are pinned to. The
 * attachment is what makes the line follow when a shape is moved — in
 * PowerPoint, and in any editor that reads it — so writing the geometry without
 * it gives a line that looks connected until something moves.
 *
 * A connection site is an index into the shape's own list of them. For the
 * preset geometries a deck actually uses, the four sides come first in the same
 * order, which is what lets a connector be pointed at "the right-hand side"
 * without resolving the geometry.
 */

/** The four sides, in the order `prstGeom` lists them. */
export const SITES = { top: 0, left: 1, bottom: 2, right: 3 } as const
export type Site = keyof typeof SITES

const centre = (transform: Transform) => ({
  x: transform.x + transform.width / 2,
  y: transform.y + transform.height / 2,
})

/** The point on a shape's edge that a site names. */
function pointAt(transform: Transform, site: Site): { x: number; y: number } {
  const middle = centre(transform)

  switch (site) {
    case 'top':
      return { x: middle.x, y: transform.y }
    case 'bottom':
      return { x: middle.x, y: transform.y + transform.height }
    case 'left':
      return { x: transform.x, y: middle.y }
    case 'right':
      return { x: transform.x + transform.width, y: middle.y }
  }
}

/**
 * Which sides of two shapes face each other.
 *
 * Whichever axis they are further apart on decides: two shapes side by side are
 * joined left to right, two stacked are joined top to bottom. Picking the
 * nearest pair of points instead would join two overlapping shapes across their
 * own middles, which draws a line inside them.
 */
export function facingSites(from: Transform, to: Transform): { start: Site; end: Site } {
  const a = centre(from)
  const b = centre(to)

  if (Math.abs(b.x - a.x) >= Math.abs(b.y - a.y)) {
    return b.x >= a.x ? { start: 'right', end: 'left' } : { start: 'left', end: 'right' }
  }
  return b.y >= a.y ? { start: 'bottom', end: 'top' } : { start: 'top', end: 'bottom' }
}

export interface NewConnector {
  from: Shape
  to: Shape
  /** `line`, `bentConnector3`, `curvedConnector3`. */
  preset?: string
}

/**
 * Adds a connector between two shapes, returning its id.
 *
 * Null when either shape has no transform of its own — a placeholder inheriting
 * its position has nothing here to measure against, and guessing would put the
 * line somewhere plausible and wrong.
 */
export function insertConnector(part: SlidePart, connector: NewConnector): number | null {
  const from = connector.from.transform
  const to = connector.to.transform
  if (from === null || to === null) return null

  const sites = facingSites(from, to)
  const start = pointAt(from, sites.start)
  const end = pointAt(to, sites.end)

  const id = nextShapeId(part)
  const round = (value: number) => String(Math.round(value))

  // A connector's box is the rectangle between its ends; the flips say which
  // way round it runs, which is how PowerPoint writes one drawn right to left.
  const x = Math.min(start.x, end.x)
  const y = Math.min(start.y, end.y)
  const width = Math.abs(end.x - start.x)
  const height = Math.abs(end.y - start.y)

  const node = element('p:cxnSp', {}, [
    element('p:nvCxnSpPr', {}, [
      element('p:cNvPr', { id: String(id), name: `Connector ${String(id)}` }),
      element('p:cNvCxnSpPr', {}, [
        element('a:stCxn', {
          id: String(connector.from.id),
          idx: String(SITES[sites.start]),
        }),
        element('a:endCxn', {
          id: String(connector.to.id),
          idx: String(SITES[sites.end]),
        }),
      ]),
      element('p:nvPr'),
    ]),
    element('p:spPr', {}, [
      element(
        'a:xfrm',
        {
          ...(end.x < start.x ? { flipH: '1' } : {}),
          ...(end.y < start.y ? { flipV: '1' } : {}),
        },
        [
          element('a:off', { x: round(x), y: round(y) }),
          element('a:ext', { cx: round(width), cy: round(height) }),
        ],
      ),
      element('a:prstGeom', { prst: connector.preset ?? 'line' }, [element('a:avLst')]),
    ]),
    element('p:style', {}, [
      element('a:lnRef', { idx: '2' }, [element('a:schemeClr', { val: 'accent1' })]),
      element('a:fillRef', { idx: '0' }, [element('a:schemeClr', { val: 'accent1' })]),
      element('a:effectRef', { idx: '1' }, [element('a:schemeClr', { val: 'accent1' })]),
      element('a:fontRef', { idx: 'minor' }, [element('a:schemeClr', { val: 'tx1' })]),
    ]),
  ])

  children(part.tree).push(node)
  return id
}
