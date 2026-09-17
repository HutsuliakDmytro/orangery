import { children, element } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { nextShapeId } from './arrange'
import type { SlidePart } from './deck'
import type { Shape, Transform } from './shape-tree'

/**
 * Making a shape that was not in the file.
 *
 * Built rather than patched, because there is nothing yet to patch. What it is
 * built as matters: a shape that states its own fill and line would ignore the
 * deck's theme, so a new shape carries a `p:style` pointing at the theme's
 * first fill and line in `accent1` — which is what PowerPoint inserts, and what
 * makes a shape drawn today match a shape drawn by anyone else in the deck.
 */

/** A readable name, as PowerPoint gives one: the preset and the shape's number. */
function nameFor(preset: string, id: number): string {
  const spaced = preset.replace(/([A-Z])/gu, ' $1').trim()
  return `${spaced.charAt(0).toUpperCase()}${spaced.slice(1)} ${String(id)}`
}

function themeStyle(): XmlNode {
  const accent = () => [element('a:schemeClr', { val: 'accent1' })]

  return element('p:style', {}, [
    element('a:lnRef', { idx: '2' }, accent()),
    element('a:fillRef', { idx: '1' }, accent()),
    element('a:effectRef', { idx: '0' }, accent()),
    element('a:fontRef', { idx: 'minor' }, [element('a:schemeClr', { val: 'lt1' })]),
  ])
}

export interface NewShape {
  /** `a:prstGeom` value: `rect`, `ellipse`, `roundRect`, `line`, … */
  preset: string
  transform: Pick<Transform, 'x' | 'y' | 'width' | 'height'>
  /** Text to put in it, if any. */
  text?: string
}

/**
 * Adds a shape to the slide and returns its id.
 *
 * It goes on top, which is where a newly drawn shape belongs — it is the thing
 * the person is looking at.
 */
export function createShape(part: SlidePart, shape: NewShape): number {
  const id = nextShapeId(part)
  const round = (value: number) => String(Math.round(value))

  const body = element('p:txBody', {}, [
    element('a:bodyPr', { rtlCol: '0', anchor: 'ctr' }),
    element('a:lstStyle'),
    element(
      'a:p',
      {},
      shape.text === undefined || shape.text === ''
        ? [element('a:pPr', { algn: 'ctr' })]
        : [
            element('a:pPr', { algn: 'ctr' }),
            element('a:r', {}, [element('a:t', {}, [{ '#text': shape.text }])]),
          ],
    ),
  ])

  const node = element('p:sp', {}, [
    element('p:nvSpPr', {}, [
      element('p:cNvPr', { id: String(id), name: nameFor(shape.preset, id) }),
      element('p:cNvSpPr'),
      element('p:nvPr'),
    ]),
    element('p:spPr', {}, [
      element('a:xfrm', {}, [
        element('a:off', { x: round(shape.transform.x), y: round(shape.transform.y) }),
        element('a:ext', {
          cx: round(Math.max(shape.transform.width, 0)),
          cy: round(Math.max(shape.transform.height, 0)),
        }),
      ]),
      element('a:prstGeom', { prst: shape.preset }, [element('a:avLst')]),
    ]),
    themeStyle(),
    body,
  ])

  children(part.tree).push(node)
  return id
}

/**
 * Removes shapes from the slide.
 *
 * Matched by node rather than by id: the caller already has the parsed shapes,
 * and looking ids up again would be a second way of reading the same thing,
 * which is a second way of being wrong.
 */
export function deleteShapes(part: SlidePart, shapes: readonly Shape[]): boolean {
  if (shapes.length === 0) return false

  const siblings = children(part.tree)
  const wanted = new Set(shapes.map((shape) => shape.node))
  const kept = siblings.filter((child) => !wanted.has(child))
  if (kept.length === siblings.length) return false

  siblings.length = 0
  siblings.push(...kept)
  return true
}
