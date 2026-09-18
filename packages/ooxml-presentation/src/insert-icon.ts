import { children, element } from '@orangery/ooxml-core'
import { customGeometry } from '@orangery/ooxml-drawingml'
import { nextShapeId } from './arrange'
import type { SlidePart } from './deck'
import type { Transform } from './shape-tree'

/**
 * Putting an icon on a slide as a shape rather than a picture.
 *
 * A picture cannot take the theme's colours, blurs when the slide is shown
 * large, and gives PowerPoint nothing to work with. The same outline as
 * `a:custGeom` is an ordinary shape: it fills from the theme, it outlines, it
 * scales, and every tool that already knows what to do with a shape knows what
 * to do with it — which is what "surviving PowerPoint" means here.
 *
 * It is filled from the theme by reference, like any shape drawn from the
 * gallery, so a deck that changes theme changes its icons with it.
 */

export interface NewIcon {
  /** What it is called in the selection pane and the alt text. */
  name: string
  /** One or more SVG outlines; a second path is how a hole stays a hole. */
  paths: readonly string[]
  /** The square the outlines are drawn in. */
  size: number
  transform: Pick<Transform, 'x' | 'y' | 'width' | 'height'>
}

function themeStyle() {
  const accent = () => [element('a:schemeClr', { val: 'accent1' })]

  return element('p:style', {}, [
    element('a:lnRef', { idx: '0' }, accent()),
    element('a:fillRef', { idx: '1' }, accent()),
    element('a:effectRef', { idx: '0' }, accent()),
    element('a:fontRef', { idx: 'minor' }, [element('a:schemeClr', { val: 'lt1' })]),
  ])
}

/** Adds the icon to the slide and returns its id. */
export function insertIcon(part: SlidePart, icon: NewIcon): number {
  const id = nextShapeId(part)
  const round = (value: number) => String(Math.round(value))

  const node = element('p:sp', {}, [
    element('p:nvSpPr', {}, [
      // The name carries into the alt text: an icon nobody can name is an icon
      // a screen reader has nothing to say about.
      element('p:cNvPr', { id: String(id), name: icon.name, descr: icon.name }),
      element('p:cNvSpPr'),
      element('p:nvPr'),
    ]),
    element('p:spPr', {}, [
      element('a:xfrm', {}, [
        element('a:off', { x: round(icon.transform.x), y: round(icon.transform.y) }),
        element('a:ext', {
          cx: round(Math.max(icon.transform.width, 0)),
          cy: round(Math.max(icon.transform.height, 0)),
        }),
      ]),
      customGeometry(icon.paths, icon.size),
    ]),
    themeStyle(),
  ])

  children(part.tree).push(node)
  return id
}
