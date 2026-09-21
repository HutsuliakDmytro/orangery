import { children, element } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { nextShapeId } from './arrange'
import type { SlidePart } from './deck'

/**
 * Keeping what was drawn on a slide during a show.
 *
 * PowerPoint stores ink as InkML in a content part of its own, wrapped for
 * compatibility. This writes a freeform shape instead — a `p:custGeom` line,
 * which is a construct the format has always had and this app already writes.
 *
 * That difference is worth stating plainly. What the room saw is what the file
 * gets, and it opens everywhere; but ours is a shape somebody can select and
 * move afterwards, and PowerPoint's is ink it treats as ink. Writing InkML
 * badly would be worse than writing a line honestly.
 */

export interface InkStroke {
  /** Where the pen went, in the slide's own units. */
  points: readonly { x: number; y: number }[]
  /** `RRGGBB`, without the hash. */
  color: string
  /** Line width in EMU. */
  width: number
  /**
   * A highlighter rather than a pen.
   *
   * Drawn behind nothing and through everything: the same line, wide and
   * half-transparent, which is what makes it read as marking rather than as
   * writing.
   */
  highlight?: boolean
}

/** The box a stroke needs, which is what the shape's transform becomes. */
function boundsOf(points: readonly { x: number; y: number }[]) {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)

  const x = Math.min(...xs)
  const y = Math.min(...ys)
  // A stroke drawn straight across has no height at all, and a shape with none
  // is a shape nothing draws; one unit is enough to give the line somewhere to
  // be without moving it anywhere.
  return {
    x,
    y,
    width: Math.max(Math.max(...xs) - x, 1),
    height: Math.max(Math.max(...ys) - y, 1),
  }
}

function pathOf(stroke: InkStroke, box: ReturnType<typeof boundsOf>): XmlNode {
  const at = (point: { x: number; y: number }, tag: string) =>
    element(tag, {}, [
      element('a:pt', {
        x: String(Math.round(point.x - box.x)),
        y: String(Math.round(point.y - box.y)),
      }),
    ])

  const [first, ...rest] = stroke.points
  if (first === undefined) return element('a:path')

  return element('a:path', { w: String(box.width), h: String(box.height) }, [
    at(first, 'a:moveTo'),
    ...rest.map((point) => at(point, 'a:lnTo')),
  ])
}

/**
 * Puts one stroke on a slide as a freeform line. Returns its id, or null.
 *
 * Refused for a stroke of one point: a line from somewhere to the same place is
 * not a mark anybody made on purpose, and it is what a stray click produces.
 */
export function addInkStroke(part: SlidePart, stroke: InkStroke): number | null {
  if (stroke.points.length < 2) return null

  const id = nextShapeId(part)
  const box = boundsOf(stroke.points)
  const width = Math.max(Math.round(stroke.width), 1)

  const line = element('a:ln', { w: String(width), cap: 'rnd' }, [
    element('a:solidFill', {}, [
      element(
        'a:srgbClr',
        { val: stroke.color.replace('#', '') },
        stroke.highlight === true ? [element('a:alpha', { val: '40000' })] : [],
      ),
    ]),
    element('a:round'),
  ])

  const node = element('p:sp', {}, [
    element('p:nvSpPr', {}, [
      element('p:cNvPr', { id: String(id), name: `Ink ${String(id)}` }),
      element('p:cNvSpPr'),
      element('p:nvPr'),
    ]),
    element('p:spPr', {}, [
      element('a:xfrm', {}, [
        element('a:off', { x: String(Math.round(box.x)), y: String(Math.round(box.y)) }),
        element('a:ext', { cx: String(box.width), cy: String(box.height) }),
      ]),
      element('a:custGeom', {}, [
        element('a:avLst'),
        element('a:gdLst'),
        element('a:rect', { l: '0', t: '0', r: 'r', b: 'b' }),
        element('a:pathLst', {}, [pathOf(stroke, box)]),
      ]),
      // A pen leaves a line and no area; a filled stroke would be a blot.
      element('a:noFill'),
      line,
    ]),
  ])

  children(part.tree).push(node)
  return id
}
