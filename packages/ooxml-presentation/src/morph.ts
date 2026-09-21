import { attribute, children, findChild, findDescendant, tagName } from '@orangery/ooxml-core'
import { textOfBody } from '@orangery/ooxml-drawingml'
import type { SlidePart } from './deck'
import { flatten } from './shape-tree'
import type { Shape, Transform } from './shape-tree'

/**
 * Which shape on one slide is which shape on the next.
 *
 * A morph is not an effect on a slide; it is the claim that two slides show the
 * same objects in different places. Everything about drawing it follows from
 * answering which is which, and getting that wrong does not look like a worse
 * morph — it looks like the wrong things flying across the screen.
 *
 * PowerPoint answers it three ways, in order. A shape duplicated onto the next
 * slide keeps a creation id, which is exact. Failing that, a name — people
 * rename shapes rarely and duplicate them often. Failing that, the same kind of
 * shape holding the same words, which is what matches a title to a title.
 */

/**
 * `a16:creationId` — the same shape, wherever it has been copied to.
 *
 * Written by PowerPoint 2016 and later inside the shape's extension list, and
 * kept by everything here because a shape is preserved whole. It is the reason
 * a morph between two hand-made slides works at all.
 */
export function creationIdOf(shape: Shape): string | null {
  const nonVisual = children(shape.node).find((child) =>
    /^p:nv[A-Za-z]*Pr$/u.test(tagName(child) ?? ''),
  )
  const identity = nonVisual === undefined ? undefined : findChild(nonVisual, 'p:cNvPr')
  const extensions = identity === undefined ? undefined : findChild(identity, 'a:extLst')
  if (extensions === undefined) return null

  for (const extension of children(extensions)) {
    const creation = findDescendant(extension, 'a16:creationId')
    const id = creation === undefined ? undefined : attribute(creation, 'val')
    if (id !== undefined && id !== '') return id
  }

  return null
}

/** What a shape is, for matching two that carry no ids and no names worth trusting. */
function signatureOf(shape: Shape): string {
  const words = shape.text === null ? '' : textOfBody(shape.text).trim()
  const preset = shape.properties?.geometry?.preset ?? ''
  return `${shape.kind}|${preset}|${words}`
}

export interface MorphPair {
  from: Shape
  to: Shape
}

/**
 * Pairs the shapes of one slide with the shapes of the next.
 *
 * Each pass takes only what is still unclaimed, and a pass that would match one
 * shape to several matches none of them: two boxes called "Rectangle 3" say
 * nothing about which is which, and picking one at random is how a morph sends
 * the wrong box across the screen.
 */
export function matchShapes(from: SlidePart, to: SlidePart): MorphPair[] {
  const before = flatten(from.shapes).filter((shape) => !shape.hidden)
  const after = flatten(to.shapes).filter((shape) => !shape.hidden)

  const pairs: MorphPair[] = []
  const taken = new Set<Shape>()
  const claimed = new Set<Shape>()

  const pass = (key: (shape: Shape) => string | null) => {
    const left = new Map<string, Shape[]>()
    for (const shape of before) {
      if (taken.has(shape)) continue
      const id = key(shape)
      if (id === null) continue
      left.set(id, [...(left.get(id) ?? []), shape])
    }

    for (const shape of after) {
      if (claimed.has(shape)) continue
      const id = key(shape)
      if (id === null) continue

      const candidates = left.get(id) ?? []
      // Exactly one on each side, or the answer is a guess.
      if (candidates.length !== 1) continue
      if (after.filter((one) => key(one) === id).length !== 1) continue

      const match = candidates[0]
      if (match === undefined) continue

      pairs.push({ from: match, to: shape })
      taken.add(match)
      claimed.add(shape)
    }
  }

  pass(creationIdOf)
  pass((shape) => (shape.name === '' ? null : shape.name))
  pass(signatureOf)

  return pairs
}

/**
 * Where each shape of the arriving slide comes from, by its id.
 *
 * Only the pairs that actually move: a shape in the same place at the same size
 * is a shape the morph has nothing to say about, and animating it from itself
 * would be a frame of work for no picture.
 */
export function morphOrigins(from: SlidePart, to: SlidePart): Map<number, Transform> {
  const origins = new Map<number, Transform>()

  for (const pair of matchShapes(from, to)) {
    const was = pair.from.transform
    const now = pair.to.transform
    if (was === null || now === null) continue

    const same =
      was.x === now.x &&
      was.y === now.y &&
      was.width === now.width &&
      was.height === now.height &&
      was.rotation === now.rotation
    if (!same) origins.set(pair.to.id, was)
  }

  return origins
}
