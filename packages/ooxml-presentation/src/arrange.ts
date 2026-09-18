import { attribute, children, findChild, setAttribute, tagName } from '@orangery/ooxml-core'
import type { SlidePart } from './deck'
import { flatten, parseShape } from './shape-tree'
import type { Shape, Transform } from './shape-tree'
import { writeTransform } from './write-shape'

/**
 * Lining shapes up, spacing them out, and making copies.
 *
 * All of it comes down to writing transforms, which is the one path already
 * proven to reach the file. What is here is the arithmetic and the one piece
 * that is not arithmetic: a duplicate needs an id no other shape on the slide
 * is using, and ids are unique per part rather than per deck.
 */

export type Alignment = 'left' | 'centre' | 'right' | 'top' | 'middle' | 'bottom'

interface Bounds {
  left: number
  top: number
  right: number
  bottom: number
}

const boundsOf = (transform: Transform): Bounds => ({
  left: transform.x,
  top: transform.y,
  right: transform.x + transform.width,
  bottom: transform.y + transform.height,
})

function union(transforms: readonly Transform[]): Bounds | null {
  const boxes = transforms.map(boundsOf)
  const first = boxes[0]
  if (first === undefined) return null

  return boxes.reduce((together, box) => ({
    left: Math.min(together.left, box.left),
    top: Math.min(together.top, box.top),
    right: Math.max(together.right, box.right),
    bottom: Math.max(together.bottom, box.bottom),
  }))
}

/**
 * Aligns shapes within a box.
 *
 * `within` is the slide for a single shape and the selection's own bounds for
 * several — which is what PowerPoint does, and is the only reading that makes
 * sense: aligning one shape to itself would do nothing at all.
 */
export function alignShapes(
  shapes: readonly Shape[],
  alignment: Alignment,
  within: Bounds,
): boolean {
  let moved = false

  for (const shape of shapes) {
    const transform = shape.transform
    if (transform === null) continue

    const next = ((): { x: number; y: number } => {
      switch (alignment) {
        case 'left':
          return { x: within.left, y: transform.y }
        case 'right':
          return { x: within.right - transform.width, y: transform.y }
        case 'centre':
          return {
            x: (within.left + within.right) / 2 - transform.width / 2,
            y: transform.y,
          }
        case 'top':
          return { x: transform.x, y: within.top }
        case 'bottom':
          return { x: transform.x, y: within.bottom - transform.height }
        case 'middle':
          return {
            x: transform.x,
            y: (within.top + within.bottom) / 2 - transform.height / 2,
          }
      }
    })()

    if (next.x === transform.x && next.y === transform.y) continue
    if (writeTransform(shape, { ...transform, ...next })) moved = true
  }

  return moved
}

/** The box to align against: the selection's own when there are several. */
export function alignmentBounds(
  shapes: readonly Shape[],
  slide: { width: number; height: number },
): Bounds {
  const transforms = shapes.flatMap((shape) => (shape.transform === null ? [] : [shape.transform]))

  if (transforms.length > 1) {
    return union(transforms) ?? { left: 0, top: 0, right: slide.width, bottom: slide.height }
  }
  return { left: 0, top: 0, right: slide.width, bottom: slide.height }
}

/**
 * Spreads shapes so the gaps between them are equal.
 *
 * The outermost two do not move — they define the span being divided — so this
 * needs three shapes to mean anything. Gaps are equalised rather than centres:
 * shapes of different sizes with evenly spaced centres do not look evenly
 * spaced, which is the whole reason the command exists.
 */
export function distributeShapes(
  shapes: readonly Shape[],
  axis: 'horizontal' | 'vertical',
): boolean {
  const placed = shapes
    .flatMap((shape) => (shape.transform === null ? [] : [{ shape, transform: shape.transform }]))
    .sort((a, b) =>
      axis === 'horizontal' ? a.transform.x - b.transform.x : a.transform.y - b.transform.y,
    )

  if (placed.length < 3) return false

  const first = placed[0]
  const last = placed[placed.length - 1]
  if (first === undefined || last === undefined) return false

  const start = axis === 'horizontal' ? first.transform.x : first.transform.y
  const size = (one: Transform) => (axis === 'horizontal' ? one.width : one.height)
  const end = (axis === 'horizontal' ? last.transform.x : last.transform.y) + size(last.transform)

  const occupied = placed.reduce((total, one) => total + size(one.transform), 0)
  const gap = (end - start - occupied) / (placed.length - 1)

  let moved = false
  let at = start + size(first.transform) + gap

  for (const one of placed.slice(1, -1)) {
    const next = axis === 'horizontal' ? { ...one.transform, x: at } : { ...one.transform, y: at }

    if (axis === 'horizontal' ? at !== one.transform.x : at !== one.transform.y) {
      if (writeTransform(one.shape, next)) moved = true
    }
    at += size(one.transform) + gap
  }

  return moved
}

/** The highest shape id in a part, so a new shape can take the next one. */
export function nextShapeId(part: SlidePart): number {
  const used = flatten(part.shapes).map((shape) => shape.id)
  return Math.max(0, ...used) + 1
}

/**
 * Copies a shape into the same slide, offset so it is visible.
 *
 * The copy keeps everything — its effects, its extension list, whatever markup
 * we never modelled — because it is the node, cloned. Only the id changes: two
 * shapes sharing one in a part is a file PowerPoint refuses.
 */
export function duplicateShape(
  part: SlidePart,
  shape: Shape,
  offset: { x: number; y: number } = { x: 228600, y: 228600 },
): number | null {
  const copy = structuredClone(shape.node)
  const nonVisual = children(copy).find((child) => /^p:nv[A-Za-z]*Pr$/u.test(tagName(child) ?? ''))
  const identity = nonVisual === undefined ? undefined : findChild(nonVisual, 'p:cNvPr')
  if (identity === undefined) return null

  const id = nextShapeId(part)
  setAttribute(identity, 'id', String(id))

  const name = attribute(identity, 'name')
  if (name !== undefined && name !== '') setAttribute(identity, 'name', `${name} copy`)

  children(part.tree).push(copy)

  // Offset through the same writer as any other move, by reading the clone
  // back as a shape — a second implementation here could disagree with it.
  offsetShape(parseShape(copy), offset)

  return id
}

/** Moves a shape by an offset. The same call a nudge makes. */
export function offsetShape(shape: Shape, by: { x: number; y: number }): boolean {
  if (shape.transform === null) return false
  return writeTransform(shape, {
    ...shape.transform,
    x: shape.transform.x + by.x,
    y: shape.transform.y + by.y,
  })
}

/**
 * Mirrors shapes about their own middles.
 *
 * Each about itself rather than the selection about its bounds: PowerPoint
 * flips every selected shape in place, and flipping the group's arrangement
 * instead would move shapes nobody asked to move. Two flips of the same axis
 * put a shape back, which is what makes the command its own undo.
 */
export function flipShapes(shapes: readonly Shape[], axis: 'horizontal' | 'vertical'): boolean {
  let changed = false

  for (const shape of shapes) {
    const transform = shape.transform
    if (transform === null) continue

    const flipped =
      axis === 'horizontal'
        ? { ...transform, flipHorizontal: !transform.flipHorizontal }
        : { ...transform, flipVertical: !transform.flipVertical }

    if (writeTransform(shape, flipped)) changed = true
  }

  return changed
}
