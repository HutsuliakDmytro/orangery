import { attribute, children, findChild, setAttribute, tagName } from '@orangery/ooxml-core'
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

      return [{ path: pathIndex, index, x, y }]
    })
  })
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
