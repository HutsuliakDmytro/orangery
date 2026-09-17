import { children, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import type { SlidePart } from './deck'
import type { Shape } from './shape-tree'

/**
 * Which shape is in front.
 *
 * There is no z attribute: a slide's shapes are drawn in the order they appear
 * in `p:spTree`, so bringing one forward means moving its element later among
 * its siblings. The tree's own `p:nvGrpSpPr` and `p:grpSpPr` come first and are
 * not shapes, so nothing may be moved before them.
 *
 * Shapes are moved as a block. Raising two shapes that sit next to each other
 * one at a time would swap them past each other; taking the selection out and
 * putting it back keeps its internal order.
 */

/** Where the shapes start, after the tree's own properties. */
function firstShapeIndex(siblings: readonly XmlNode[]): number {
  const index = siblings.findIndex(
    (child) => !/^p:(nvGrpSpPr|grpSpPr)$/u.test(tagName(child) ?? ''),
  )
  return index === -1 ? siblings.length : index
}

type Move = 'front' | 'back' | 'forward' | 'backward'

/**
 * Moves the given shapes within their tree.
 *
 * Returns false when nothing moved, so a caller can leave no undo step behind
 * for a selection that is already at the front.
 */
export function reorderShapes(part: SlidePart, shapes: readonly Shape[], move: Move): boolean {
  if (shapes.length === 0) return false

  const siblings = children(part.tree)
  const floor = firstShapeIndex(siblings)
  const nodes = new Set(shapes.map((shape) => shape.node))

  const taken = siblings.filter((child, index) => index >= floor && nodes.has(child))
  if (taken.length === 0) return false

  const rest = siblings.filter((child, index) => index < floor || !nodes.has(child))

  /**
   * Where the block sits among the shapes that are not moving.
   *
   * Counted rather than derived from the original indices: once the selection
   * is taken out, everything after it shifts, and the arithmetic to undo that
   * is the kind that is wrong in one direction only.
   */
  const lowest = siblings.findIndex((child) => nodes.has(child))
  const base = siblings.filter((child, index) => index < lowest && !nodes.has(child)).length

  const at = ((): number => {
    switch (move) {
      case 'front':
        return rest.length
      case 'back':
        return floor
      case 'forward':
        return base + 1
      case 'backward':
        return base - 1
    }
  })()

  const target = Math.min(Math.max(at, floor), rest.length)
  const reordered = [...rest.slice(0, target), ...taken, ...rest.slice(target)]

  /**
   * Compared rather than reasoned about.
   *
   * "Already at the back" is not a property of the first selected shape: a
   * selection with a gap in it can have its lowest member at the back and still
   * have somewhere to go. Building the answer and seeing whether it differs is
   * both shorter and right in the cases the arithmetic was wrong in.
   */
  if (reordered.every((child, index) => child === siblings[index])) return false

  siblings.length = 0
  siblings.push(...reordered)
  return true
}
