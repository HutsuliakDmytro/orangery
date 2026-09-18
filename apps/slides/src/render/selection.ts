import type { Shape } from '@orangery/ooxml-presentation'

/**
 * What a click on a shape actually selects.
 *
 * A group is a thing in its own right: clicking any of its members selects the
 * whole group, and moving it moves all of them. Getting inside is a deliberate
 * act — a double click — and then the next click picks out a member. That is
 * what PowerPoint does, what Illustrator does, and what anyone who has ever
 * grouped anything expects.
 *
 * Groups nest, so "inside" is a position in a chain rather than a flag. Opening
 * the outer group of three still selects the middle one; opening that selects
 * the innermost shape. Walking out again is `Escape`, one level at a time.
 */

export interface Clicked {
  /** The shape whose hit target was clicked. */
  shape: Shape
  /** Its groups, outermost first. */
  ancestors: readonly Shape[]
}

/**
 * The shape a click selects, given which group is currently open.
 *
 * `open` is the group the pointer is considered to be inside. A click on
 * something that is not in that group selects that thing's outermost group
 * instead, which is how clicking away gets you back out.
 */
export function selectionTarget(clicked: Clicked, open: number | null): Shape {
  const { shape, ancestors } = clicked
  if (ancestors.length === 0) return shape

  if (open === null) return ancestors[0] ?? shape

  const depth = ancestors.findIndex((one) => one.id === open)
  // Inside some other group, or inside none of this shape's: the click is
  // outside what is open, and selects from the top again.
  if (depth === -1) return ancestors[0] ?? shape

  return ancestors[depth + 1] ?? shape
}

/**
 * The group a double click opens, or null when there is none to open.
 *
 * Only ever one level: a double click on a shape three groups deep opens the
 * outermost, and it takes three of them to reach the shape. Jumping straight to
 * the bottom would make the nesting invisible, and the way out would then be a
 * surprise.
 */
export function groupToOpen(clicked: Clicked, open: number | null): number | null {
  const target = selectionTarget(clicked, open)
  return target.kind === 'grpSp' ? target.id : null
}

/**
 * The group left after stepping out of `open`, or null at the top.
 *
 * Which chain to step out along is decided by what is selected: the selection
 * is inside the open group, so its ancestors are the chain. With nothing
 * selected there is nothing to be inside, and the answer is the top.
 */
export function groupAfterEscape(
  open: number | null,
  ancestorsOfSelection: readonly Shape[],
): number | null {
  if (open === null) return null

  const depth = ancestorsOfSelection.findIndex((one) => one.id === open)
  if (depth <= 0) return null

  return ancestorsOfSelection[depth - 1]?.id ?? null
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Whether a shape's box is caught by a marquee.
 *
 * Fully enclosed, not merely touched. PowerPoint requires the whole shape to be
 * inside the rubber band, and the difference matters on a crowded slide: with
 * "touched", dragging a band across the middle of a deck of overlapping boxes
 * selects all of them, and there is no gesture left that selects a few.
 */
export function enclosedBy(box: Box, marquee: Box): boolean {
  const right = marquee.x + marquee.width
  const bottom = marquee.y + marquee.height

  return (
    box.x >= marquee.x &&
    box.y >= marquee.y &&
    box.x + box.width <= right &&
    box.y + box.height <= bottom
  )
}

/** A marquee from two corners, in whichever order they were dragged. */
export function boxFrom(from: { x: number; y: number }, to: { x: number; y: number }): Box {
  return {
    x: Math.min(from.x, to.x),
    y: Math.min(from.y, to.y),
    width: Math.abs(to.x - from.x),
    height: Math.abs(to.y - from.y),
  }
}
