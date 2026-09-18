import { attribute, children, element, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * SVG path data as DrawingML custom geometry.
 *
 * An icon inserted as a picture is a picture: it cannot take the theme's
 * colours, it blurs when the slide is shown large, and PowerPoint offers
 * nothing to do with it. The same outline as `a:custGeom` is a shape — it
 * fills, it outlines, it scales, and everything the format already knows how to
 * do to a shape works on it.
 *
 * Arcs are refused rather than approximated. `A` is an ellipse segment with its
 * own parameterisation, and turning one into beziers is a decision about how
 * much error is acceptable that nothing here is in a position to make; the
 * bundled icons are drawn without them.
 */

export class UnsupportedPathError extends Error {
  override readonly name = 'UnsupportedPathError'
}

export interface Point {
  x: number
  y: number
}

export type PathSegment =
  | { kind: 'move'; to: Point }
  | { kind: 'line'; to: Point }
  | { kind: 'cubic'; first: Point; second: Point; to: Point }
  | { kind: 'quad'; control: Point; to: Point }
  | { kind: 'close' }

const NUMBER = /-?\d*\.?\d+(?:e[-+]?\d+)?/giu

/** Splits path data into commands, each with the numbers that follow it. */
function* commandsOf(data: string): Generator<{ code: string; values: number[] }> {
  const pattern = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/gu

  for (const match of data.matchAll(pattern)) {
    const code = match[1] ?? ''
    const values = (match[2] ?? '').match(NUMBER)?.map(Number) ?? []
    yield { code, values }
  }
}

/**
 * Reads SVG path data into segments.
 *
 * Relative commands are resolved as they are read, and the shorthands `S` and
 * `T` are turned into the full curve they stand for: a path is a sequence of
 * points, and carrying three spellings of the same curve further in would put
 * the reflection rule in two places.
 */
export function parseSvgPath(data: string): PathSegment[] {
  const segments: PathSegment[] = []

  let current: Point = { x: 0, y: 0 }
  let start: Point = { x: 0, y: 0 }
  /** The last curve's second control point, for the shorthands to reflect. */
  let lastCubic: Point | null = null
  let lastQuad: Point | null = null

  const reflect = (control: Point | null): Point =>
    control === null ? current : { x: 2 * current.x - control.x, y: 2 * current.y - control.y }

  for (const { code, values } of commandsOf(data)) {
    const relative = code === code.toLowerCase()
    const upper = code.toUpperCase()

    if (upper === 'A') {
      throw new UnsupportedPathError(
        'An arc cannot be written as custom geometry without guessing.',
      )
    }

    if (upper === 'Z') {
      segments.push({ kind: 'close' })
      current = start
      lastCubic = null
      lastQuad = null
      continue
    }

    const step = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2 }[upper] ?? 0
    if (step === 0) continue

    for (let at = 0; at + step <= values.length; at += step) {
      const take = (offset: number) => values[at + offset] ?? 0
      const point = (x: number, y: number): Point =>
        relative ? { x: current.x + x, y: current.y + y } : { x, y }

      if (upper === 'M') {
        const to = point(take(0), take(1))
        // Every point after the first of a moveto is a lineto, which is how
        // most generators write a polygon.
        segments.push({ kind: at === 0 ? 'move' : 'line', to })
        if (at === 0) start = to
        current = to
        lastCubic = null
        lastQuad = null
        continue
      }

      if (upper === 'L' || upper === 'H' || upper === 'V') {
        // `H` and `V` move along one axis and leave the other where it was,
        // which is true of the relative forms as much as the absolute ones.
        const to: Point =
          upper === 'H'
            ? { x: relative ? current.x + take(0) : take(0), y: current.y }
            : upper === 'V'
              ? { x: current.x, y: relative ? current.y + take(0) : take(0) }
              : point(take(0), take(1))

        segments.push({ kind: 'line', to })
        current = to
        lastCubic = null
        lastQuad = null
        continue
      }

      if (upper === 'C' || upper === 'S') {
        const first: Point = upper === 'C' ? point(take(0), take(1)) : reflect(lastCubic)
        const second: Point = upper === 'C' ? point(take(2), take(3)) : point(take(0), take(1))
        const to: Point = upper === 'C' ? point(take(4), take(5)) : point(take(2), take(3))

        segments.push({ kind: 'cubic', first, second, to })
        current = to
        lastCubic = second
        lastQuad = null
        continue
      }

      const control: Point = upper === 'Q' ? point(take(0), take(1)) : reflect(lastQuad)
      const to: Point = upper === 'Q' ? point(take(2), take(3)) : point(take(0), take(1))

      segments.push({ kind: 'quad', control, to })
      current = to
      lastQuad = control
      lastCubic = null
    }
  }

  return segments
}

const pt = (point: Point): XmlNode =>
  element('a:pt', { x: String(Math.round(point.x)), y: String(Math.round(point.y)) })

/**
 * Builds `a:custGeom` from paths drawn in a box of `size` by `size`.
 *
 * The path states its own coordinate space, which the shape's extent is mapped
 * onto — so an icon drawn in a 24-unit box keeps its proportions at any size on
 * the slide without anything being scaled here.
 */
export function customGeometry(paths: readonly string[], size: number): XmlNode {
  const drawn = paths.map((data) => {
    const segments = parseSvgPath(data).map((segment): XmlNode => {
      switch (segment.kind) {
        case 'move':
          return element('a:moveTo', {}, [pt(segment.to)])
        case 'line':
          return element('a:lnTo', {}, [pt(segment.to)])
        case 'cubic':
          return element('a:cubicBezTo', {}, [
            pt(segment.first),
            pt(segment.second),
            pt(segment.to),
          ])
        case 'quad':
          return element('a:quadBezTo', {}, [pt(segment.control), pt(segment.to)])
        case 'close':
          return element('a:close')
      }
    })

    return element('a:path', { w: String(size), h: String(size) }, segments)
  })

  return element('a:custGeom', {}, [
    element('a:avLst'),
    element('a:gdLst'),
    element('a:ahLst'),
    element('a:cxnLst'),
    element('a:rect', { l: '0', t: '0', r: 'r', b: 'b' }),
    element('a:pathLst', {}, drawn),
  ])
}

export interface CustomPath {
  /** The coordinate space the points are in. */
  width: number
  height: number
  segments: PathSegment[]
}

/**
 * Reads `a:custGeom` back into segments.
 *
 * Returns null for a path holding anything not modelled here — `a:arcTo` above
 * all, which real files do use. Drawing three quarters of a shape is worse than
 * drawing the box it sits in and saying so, and the file keeps its own XML
 * either way.
 */
export function readCustomGeometry(geometry: XmlNode): CustomPath[] | null {
  const list = children(geometry).find((child) => tagName(child) === 'a:pathLst')
  if (list === undefined) return null

  const paths: CustomPath[] = []

  for (const path of children(list)) {
    if (tagName(path) !== 'a:path') continue

    const width = Number(attribute(path, 'w'))
    const height = Number(attribute(path, 'h'))
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null
    }

    const segments: PathSegment[] = []
    for (const command of children(path)) {
      const points = children(command)
        .filter((child) => tagName(child) === 'a:pt')
        .map((child) => ({ x: Number(attribute(child, 'x')), y: Number(attribute(child, 'y')) }))

      if (points.some((point) => !Number.isFinite(point.x) || !Number.isFinite(point.y))) {
        return null
      }

      const [first, second, third] = points
      switch (tagName(command)) {
        case 'a:moveTo':
          if (first === undefined) return null
          segments.push({ kind: 'move', to: first })
          break
        case 'a:lnTo':
          if (first === undefined) return null
          segments.push({ kind: 'line', to: first })
          break
        case 'a:cubicBezTo':
          if (first === undefined || second === undefined || third === undefined) return null
          segments.push({ kind: 'cubic', first, second, to: third })
          break
        case 'a:quadBezTo':
          if (first === undefined || second === undefined) return null
          segments.push({ kind: 'quad', control: first, to: second })
          break
        case 'a:close':
          segments.push({ kind: 'close' })
          break
        default:
          return null
      }
    }

    paths.push({ width, height, segments })
  }

  return paths.length === 0 ? null : paths
}

/** Writes segments as SVG path data, scaled out of their own space into a box. */
export function toSvgPath(path: CustomPath, box: { width: number; height: number }): string {
  const sx = box.width / path.width
  const sy = box.height / path.height
  const at = (point: Point) => `${String(point.x * sx)} ${String(point.y * sy)}`

  return path.segments
    .map((segment) => {
      switch (segment.kind) {
        case 'move':
          return `M ${at(segment.to)}`
        case 'line':
          return `L ${at(segment.to)}`
        case 'cubic':
          return `C ${at(segment.first)} ${at(segment.second)} ${at(segment.to)}`
        case 'quad':
          return `Q ${at(segment.control)} ${at(segment.to)}`
        case 'close':
          return 'Z'
      }
    })
    .join(' ')
}
