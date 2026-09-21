import { children, element, findChild, removeChild, setAttribute } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { SITES } from './insert-connector'
import type { Site } from './insert-connector'
import { writeTransform } from './write-shape'
import type { Shape, Transform } from './shape-tree'

/**
 * Moving the end of a connector.
 *
 * A connector says where it is drawn and, separately, what it is pinned to.
 * Dragging an end has to change both, or the line goes where the pointer said
 * and springs back to its old shape the moment anything moves — which looks
 * like the drag was ignored, a beat later.
 *
 * Letting an end go is as much a part of this as attaching it. A connector with
 * a stale `a:stCxn` follows a shape it is no longer touching, and that is worse
 * than a line attached to nothing, because nothing on screen says why.
 */

export type ConnectorEnd = 'start' | 'end'

/**
 * Where a connector's ends are, in the slide's coordinates.
 *
 * The box is the rectangle between the ends; which corner is the start is what
 * the flips say. A connector drawn right to left has the same box as one drawn
 * left to right, and only `flipH` tells them apart.
 */
export function connectorEnds(transform: Transform): {
  start: { x: number; y: number }
  end: { x: number; y: number }
} {
  const left = transform.x
  const right = transform.x + transform.width
  const top = transform.y
  const bottom = transform.y + transform.height

  return {
    start: { x: transform.flipHorizontal ? right : left, y: transform.flipVertical ? bottom : top },
    end: { x: transform.flipHorizontal ? left : right, y: transform.flipVertical ? top : bottom },
  }
}

/** The point on a shape's edge that a site names. */
export function sitePoint(transform: Transform, site: Site): { x: number; y: number } {
  const middle = { x: transform.x + transform.width / 2, y: transform.y + transform.height / 2 }

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
 * The side of a shape nearest a point.
 *
 * By distance to the side's own point rather than by which quadrant the point
 * falls in: a wide, short shape has sides whose midpoints are nothing like
 * equidistant, and quadrants would hand a point just above the middle to the
 * top of a shape ten times wider than it is tall.
 */
export function nearestSite(transform: Transform, point: { x: number; y: number }): Site {
  let best: Site = 'top'
  let closest = Infinity

  for (const site of ['top', 'left', 'bottom', 'right'] as const) {
    const at = sitePoint(transform, site)
    const distance = (at.x - point.x) ** 2 + (at.y - point.y) ** 2
    if (distance < closest) {
      closest = distance
      best = site
    }
  }

  return best
}

const TAGS: Record<ConnectorEnd, string> = { start: 'a:stCxn', end: 'a:endCxn' }

/** The `p:cNvCxnSpPr` a connector keeps its attachments in. */
function attachments(connector: Shape): XmlNode | undefined {
  const nonVisual = findChild(connector.node, 'p:nvCxnSpPr')
  return nonVisual === undefined ? undefined : findChild(nonVisual, 'p:cNvCxnSpPr')
}

function attach(
  connector: Shape,
  which: ConnectorEnd,
  to: { id: number; site: Site } | null,
): void {
  const holder = attachments(connector)
  if (holder === undefined) return

  const tag = TAGS[which]
  const existing = findChild(holder, tag)

  if (to === null) {
    removeChild(holder, tag)
    return
  }

  const attributes = { id: String(to.id), idx: String(SITES[to.site]) }
  if (existing === undefined) {
    // `a:stCxn` comes before `a:endCxn`, and both before anything else the
    // element holds; putting them at the front keeps that without sorting.
    children(holder).unshift(element(tag, attributes))
    return
  }

  setAttribute(existing, 'id', attributes.id)
  setAttribute(existing, 'idx', attributes.idx)
}

export interface EndMove {
  /** Where the end was dragged to, in slide EMU. */
  point: { x: number; y: number }
  /** The shape it landed on, if it landed on one. */
  onto?: Shape | null
}

/**
 * Points one end of a connector somewhere else.
 *
 * Landing on a shape pins the end to that shape's nearest side and snaps the
 * line to it, because a connector that stops a hair short of what it is
 * attached to is the thing everyone spends five minutes nudging. Landing on
 * nothing lets the end go, and leaves it exactly where the pointer did.
 */
export function moveConnectorEnd(connector: Shape, which: ConnectorEnd, move: EndMove): boolean {
  const transform = connector.transform
  if (transform === null) return false

  const ends = connectorEnds(transform)
  const target = move.onto ?? null
  const onto = target?.transform ?? null

  const site = onto === null ? null : nearestSite(onto, move.point)
  const landed = onto === null || site === null ? move.point : sitePoint(onto, site)

  const start = which === 'start' ? landed : ends.start
  const end = which === 'end' ? landed : ends.end

  attach(connector, which, target === null || site === null ? null : { id: target.id, site })

  return writeTransform(connector, {
    ...transform,
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
    flipHorizontal: end.x < start.x,
    flipVertical: end.y < start.y,
  })
}
