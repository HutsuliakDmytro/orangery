import type { Shape, Transform } from './shape-tree'

/**
 * Where a shape inside a group actually sits.
 *
 * A group states two rectangles: where it is on the slide (`a:off`/`a:ext`) and
 * the coordinate space its children are written in (`a:chOff`/`a:chExt`). The
 * children's coordinates mean nothing on their own — they are read against the
 * child space and then mapped onto where the group sits.
 *
 * That indirection is what lets a group be dragged and resized without touching
 * a single child: PowerPoint rewrites the group's `ext` and every child follows.
 * Which also means a renderer that reads a child's `a:off` as a slide position
 * draws grouped shapes in the wrong place and at the wrong size, and gets more
 * wrong the further the group has been moved.
 */

/** Maps one transform from a group's child space onto the slide. */
export function throughGroup(child: Transform, group: Transform): Transform {
  const space = group.child
  // A group without a child space maps one to one; scaling by zero would send
  // every child to a single point.
  if (space === null || space.width === 0 || space.height === 0) return child

  const scaleX = group.width / space.width
  const scaleY = group.height / space.height

  return {
    ...child,
    x: group.x + (child.x - space.x) * scaleX,
    y: group.y + (child.y - space.y) * scaleY,
    width: child.width * scaleX,
    height: child.height * scaleY,
    child:
      child.child === null
        ? null
        : {
            ...child.child,
            // A nested group keeps its own child space untouched: it is
            // expressed in its own coordinates, which the next step maps again.
          },
  }
}

/**
 * The transform of a shape on the slide, given the groups it sits inside.
 *
 * `ancestors` runs outermost first, which is the order a tree walk produces.
 */
export function absoluteTransform(
  transform: Transform | null,
  ancestors: readonly Shape[],
): Transform | null {
  if (transform === null) return null

  let mapped = transform
  // Innermost group first: a child is in its immediate parent's space, and that
  // parent is in its own parent's.
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const group = ancestors[index]?.transform
    if (group == null) continue
    mapped = throughGroup(mapped, group)
  }

  return mapped
}

/** Every shape in the tree with the groups it sits inside, outermost first. */
export function withAncestors(
  shapes: readonly Shape[],
  ancestors: readonly Shape[] = [],
): { shape: Shape; ancestors: Shape[] }[] {
  return shapes.flatMap((shape) => [
    { shape, ancestors: [...ancestors] },
    ...withAncestors(shape.shapes, [...ancestors, shape]),
  ])
}
