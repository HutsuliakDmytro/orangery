import { children, element, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { nextShapeId } from './arrange'
import type { SlidePart } from './deck'
import { throughGroup } from './group-transform'
import { parseShape } from './shape-tree'
import type { Shape, Transform } from './shape-tree'
import { writeTransform } from './write-shape'

/**
 * Putting shapes into a group, and taking them out again.
 *
 * A group states where it sits and the coordinate space its children are
 * written in. When a group is made, those two are set to the same rectangle —
 * the union of what went in — so the mapping is the identity and **nothing
 * moves**. Any other choice scales every child the moment it is grouped, which
 * looks like the shapes jumping and is the failure this is written to avoid.
 *
 * Ungrouping is the same arithmetic run backwards: each child's position is
 * resolved through the group it is leaving and written down, because once the
 * group is gone there is nothing left to resolve it against.
 */

function unionOf(shapes: readonly Shape[]): Transform | null {
  const boxes = shapes.flatMap((shape) => (shape.transform === null ? [] : [shape.transform]))
  const first = boxes[0]
  if (first === undefined) return null

  const left = Math.min(...boxes.map((box) => box.x))
  const top = Math.min(...boxes.map((box) => box.y))
  const right = Math.max(...boxes.map((box) => box.x + box.width))
  const bottom = Math.max(...boxes.map((box) => box.y + box.height))

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top,
    rotation: 0,
    flipHorizontal: false,
    flipVertical: false,
    child: { x: left, y: top, width: right - left, height: bottom - top },
  }
}

function groupElement(id: number, bounds: Transform, members: readonly XmlNode[]): XmlNode {
  const size = (x: number, y: number, cx: number, cy: number) => [
    element('a:off', { x: String(Math.round(x)), y: String(Math.round(y)) }),
    element('a:ext', { cx: String(Math.round(cx)), cy: String(Math.round(cy)) }),
    element('a:chOff', { x: String(Math.round(x)), y: String(Math.round(y)) }),
    element('a:chExt', { cx: String(Math.round(cx)), cy: String(Math.round(cy)) }),
  ]

  return element('p:grpSp', {}, [
    element('p:nvGrpSpPr', {}, [
      element('p:cNvPr', { id: String(id), name: `Group ${String(id)}` }),
      element('p:cNvGrpSpPr'),
      element('p:nvPr'),
    ]),
    element('p:grpSpPr', {}, [
      element('a:xfrm', {}, size(bounds.x, bounds.y, bounds.width, bounds.height)),
    ]),
    ...members,
  ])
}

/**
 * Groups shapes, returning the new group's id.
 *
 * The group takes the place of the frontmost member, so grouping does not
 * change what is drawn over what.
 */
export function groupShapes(part: SlidePart, shapes: readonly Shape[]): number | null {
  if (shapes.length < 2) return null

  const bounds = unionOf(shapes)
  if (bounds === null) return null

  const siblings = children(part.tree)
  const nodes = new Set(shapes.map((shape) => shape.node))
  const members = siblings.filter((child) => nodes.has(child))
  if (members.length !== shapes.length) return null

  // Where the frontmost member was, counted among the shapes that stay.
  const last = siblings.reduce((at, child, index) => (nodes.has(child) ? index : at), -1)
  const rest = siblings.filter((child) => !nodes.has(child))
  const at = siblings.filter((child, index) => index <= last && !nodes.has(child)).length

  const id = nextShapeId(part)
  const group = groupElement(id, bounds, members)

  siblings.length = 0
  siblings.push(...rest.slice(0, at), group, ...rest.slice(at))
  return id
}

/**
 * Takes a group apart, leaving its children where they were drawn.
 *
 * Each child's transform is resolved through the group and written down first:
 * a child's own coordinates mean something only inside its group's space, and
 * once the group is gone they would be read against the slide instead.
 */
export function ungroupShape(part: SlidePart, group: Shape): boolean {
  if (group.kind !== 'grpSp' || group.transform === null) return false

  const siblings = children(part.tree)
  const at = siblings.indexOf(group.node)
  if (at === -1) return false

  const members = children(group.node).filter(
    (child) => !/^p:(nvGrpSpPr|grpSpPr)$/u.test(tagName(child) ?? ''),
  )
  if (members.length === 0) return false

  for (const member of members) {
    const shape = parseShape(member)
    if (shape.transform === null) continue
    writeTransform(shape, throughGroup(shape.transform, group.transform))
  }

  siblings.splice(at, 1, ...members)
  return true
}
