import {
  attribute,
  children,
  element,
  findChild,
  setAttribute,
  tagName,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { Shape } from './shape-tree'

/**
 * The vertices of a shape's own outline.
 *
 * Read and written straight on the XML rather than through the parsed path,
 * because the parsed path is a reading of what we can draw and this has to work
 * on shapes holding what we cannot. A `custGeom` with an `a:arcTo` in it comes
 * back as null from the reader — quite rightly, since drawing three quarters of
 * a shape is worse than drawing its box — but its `a:moveTo` points are still
 * points, and moving one should still work and leave the arc alone.
 *
 * So everything here patches attributes on nodes that are already there.
 * `a:avLst`, `a:gdLst`, the adjustment handles and anything else the shape
 * carries are never touched.
 */

export interface GeometryPoint {
  /** Which `a:path`, in the order they appear. */
  path: number
  /** Which `a:pt` within that path, counting every command's points in order. */
  index: number
  /** In the path's own coordinate space, not the slide's. */
  x: number
  y: number
  /**
   * Whether this is a corner the outline passes through.
   *
   * A curve states the handles that shape it before the point it arrives at, so
   * most points in a `cubicBezTo` are not corners. Only a corner can be removed
   * or followed by a new one; a handle on its own means nothing.
   */
  vertex: boolean
}

/** The `a:pathLst` of a shape's custom geometry, when it has one. */
function pathList(shape: Shape): XmlNode | undefined {
  const properties = findChild(shape.node, 'p:spPr') ?? findChild(shape.node, 'a:spPr')
  const geometry = properties === undefined ? undefined : findChild(properties, 'a:custGeom')
  return geometry === undefined ? undefined : findChild(geometry, 'a:pathLst')
}

/** Every `a:pt` of one path, in document order. */
function pointsOf(path: XmlNode): XmlNode[] {
  return children(path).flatMap((command) =>
    children(command).filter((child) => tagName(child) === 'a:pt'),
  )
}

/** The size of the space a path's points are written in. */
export function pathSpace(shape: Shape, path: number): { width: number; height: number } | null {
  const list = pathList(shape)
  const found = list === undefined ? undefined : children(list)[path]
  if (found === undefined || tagName(found) !== 'a:path') return null

  const width = Number(attribute(found, 'w'))
  const height = Number(attribute(found, 'h'))
  return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0
    ? { width, height }
    : null
}

/**
 * How many points each path command carries.
 *
 * The last of them is the vertex the segment arrives at; the ones before it are
 * the handles that shape the curve on the way. That difference is what decides
 * which points can be taken out: a handle is not a corner, and removing one
 * would leave a curve missing a piece of its own definition.
 */
const POINTS_PER_COMMAND: Readonly<Record<string, number>> = {
  'a:moveTo': 1,
  'a:lnTo': 1,
  'a:arcTo': 0,
  'a:quadBezTo': 2,
  'a:cubicBezTo': 3,
  'a:close': 0,
}

interface Owner {
  /** The command element holding the point. */
  command: XmlNode
  /** Its place among the path's children. */
  at: number
  /** Whether the point is the vertex the command ends on rather than a handle. */
  vertex: boolean
}

/** Which command a point belongs to, counting through the path in order. */
function ownerOf(path: XmlNode, index: number): Owner | null {
  let seen = 0

  const commands = children(path)
  for (let at = 0; at < commands.length; at += 1) {
    const command = commands[at]
    if (command === undefined) continue

    const points = children(command).filter((child) => tagName(child) === 'a:pt')
    if (index < seen + points.length) {
      return { command, at, vertex: index === seen + points.length - 1 }
    }
    seen += points.length
  }

  return null
}

/** Every vertex the shape states, or an empty list for one with no geometry. */
export function geometryPoints(shape: Shape): GeometryPoint[] {
  const list = pathList(shape)
  if (list === undefined) return []

  return children(list).flatMap((path, pathIndex) => {
    if (tagName(path) !== 'a:path') return []

    return pointsOf(path).flatMap((point, index) => {
      const x = Number(attribute(point, 'x'))
      const y = Number(attribute(point, 'y'))
      if (!Number.isFinite(x) || !Number.isFinite(y)) return []

      return [{ path: pathIndex, index, x, y, vertex: ownerOf(path, index)?.vertex ?? true }]
    })
  })
}

/** Whether a path comes back to where it started, which closes the outline. */
export function pathIsClosed(shape: Shape, path: number): boolean {
  const list = pathList(shape)
  const found = list === undefined ? undefined : children(list)[path]
  if (found === undefined || tagName(found) !== 'a:path') return false

  return children(found).some((command) => tagName(command) === 'a:close')
}

/**
 * Moves one vertex, in the path's own coordinates.
 *
 * Clamped to the path's space: a point outside it draws outside the shape's
 * box, which PowerPoint allows and which looks, to anybody dragging, like the
 * shape came apart.
 */
export function moveGeometryPoint(
  shape: Shape,
  at: { path: number; index: number },
  to: { x: number; y: number },
): boolean {
  const list = pathList(shape)
  const path = list === undefined ? undefined : children(list)[at.path]
  if (path === undefined || tagName(path) !== 'a:path') return false

  const point = pointsOf(path)[at.index]
  const space = pathSpace(shape, at.path)
  if (point === undefined || space === null) return false

  const clamp = (value: number, limit: number) => Math.min(Math.max(Math.round(value), 0), limit)
  setAttribute(point, 'x', String(clamp(to.x, space.width)))
  setAttribute(point, 'y', String(clamp(to.y, space.height)))
  return true
}

const pointElement = (x: number, y: number): XmlNode =>
  element('a:pt', { x: String(Math.round(x)), y: String(Math.round(y)) })

/**
 * Puts a new vertex into the outline, just after the one named.
 *
 * Always a straight segment: the point a person asked for is a corner they
 * pointed at, and inventing the curve that would pass through it is inventing
 * something they did not ask for. A curve can be made afterwards by dragging.
 *
 * Refused where it would not mean anything — a handle rather than a vertex, or
 * a shape with no outline of its own.
 */
export function addGeometryPoint(
  shape: Shape,
  at: { path: number; index: number },
  to: { x: number; y: number },
): boolean {
  const list = pathList(shape)
  const path = list === undefined ? undefined : children(list)[at.path]
  const space = pathSpace(shape, at.path)
  if (path === undefined || tagName(path) !== 'a:path' || space === null) return false

  const owner = ownerOf(path, at.index)
  if (owner === null || !owner.vertex) return false

  const clamp = (value: number, limit: number) => Math.min(Math.max(value, 0), limit)
  const added = element('a:lnTo', {}, [
    pointElement(clamp(to.x, space.width), clamp(to.y, space.height)),
  ])

  // After the command the point arrived on, which is before any `a:close` that
  // follows: the new corner is part of the outline, not something after it.
  children(path).splice(owner.at + 1, 0, added)
  return true
}

/**
 * Takes a vertex out of the outline.
 *
 * The whole command goes, handles and all — a curve without the corner it
 * curved towards is not a shorter curve, it is a broken one.
 *
 * Two refusals worth naming. A handle is not a vertex, so it cannot be removed
 * on its own. And a path needs a start: removing the `a:moveTo` promotes what
 * follows it, which only works when what follows arrives at a point of its own
 * — a curve cannot become a starting position, because its handles are stated
 * relative to a corner that would no longer be there.
 */
export function removeGeometryPoint(shape: Shape, at: { path: number; index: number }): boolean {
  const list = pathList(shape)
  const path = list === undefined ? undefined : children(list)[at.path]
  if (path === undefined || tagName(path) !== 'a:path') return false

  const owner = ownerOf(path, at.index)
  if (owner === null || !owner.vertex) return false

  // Three corners is the least an outline can be. Below that there is nothing
  // to draw, and a shape whose outline vanished is a shape nobody can get back.
  const corners = children(path).filter(
    (command) => (POINTS_PER_COMMAND[tagName(command) ?? ''] ?? 0) > 0,
  )
  if (corners.length <= 3) return false

  const commands = children(path)
  if (tagName(owner.command) === 'a:moveTo') {
    const next = commands[owner.at + 1]
    if (next === undefined || tagName(next) !== 'a:lnTo') return false

    // What followed the start becomes the start. Both carry one point, so this
    // is a rename and nothing else.
    const point = children(next).find((child) => tagName(child) === 'a:pt')
    commands.splice(owner.at, 2, element('a:moveTo', {}, point === undefined ? [] : [point]))
    return true
  }

  commands.splice(owner.at, 1)
  return true
}
