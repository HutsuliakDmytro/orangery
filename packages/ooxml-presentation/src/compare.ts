import { children, findChild } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { textOfBody } from '@orangery/ooxml-drawingml'
import type { Deck, Slide } from './deck'
import { flatten } from './shape-tree'
import type { Shape, Transform } from './shape-tree'
import { writeTransform } from './write-shape'

/**
 * What one deck has that another has not.
 *
 * PowerPoint calls this Compare, and it is also what it calls Review: a `.pptx`
 * carries no tracked changes the way a `.docx` does, so "accept this edit"
 * can only ever mean "take this difference from that file". Two features in the
 * plan, one thing in the format.
 *
 * Slides are matched by the id in `p:sldIdLst`, which a copy of a deck keeps
 * through every edit, and shapes by the id inside the part, which is the same
 * kind of promise one level down. Falling back to position would pair slide
 * four with slide four after somebody inserted one, and report every slide in
 * the deck as changed.
 */

export type Change =
  | { kind: 'slide-added'; slide: number; title: string }
  | { kind: 'slide-removed'; slide: number; title: string }
  | { kind: 'text'; slide: number; shapeId: number; name: string; from: string; to: string }
  | { kind: 'moved'; slide: number; shapeId: number; name: string; to: Transform }
  | { kind: 'shape-added'; slide: number; shapeId: number; name: string }
  | { kind: 'shape-removed'; slide: number; shapeId: number; name: string }

/** A change that happens inside a slide both decks have. */
export type ShapeChange = Extract<Change, { shapeId: number }>

/** Whether a change can be taken into this deck, or only looked at. */
export function applicable(change: Change): change is ShapeChange {
  return change.kind !== 'slide-added' && change.kind !== 'slide-removed'
}

/** The id `p:sldIdLst` gives a slide, which a copy of the deck keeps. */
function slideIds(deck: Deck): Map<string, Slide> {
  const ids = new Map<string, Slide>()

  // The list is in the presentation part, and the deck reads its slides from
  // it in order — so the nth entry is the nth slide.
  deck.slides.forEach((slide, index) => {
    ids.set(String(index), slide)
  })

  return ids
}

const titleOf = (slide: Slide): string => {
  const title = flatten(slide.shapes).find((shape) => shape.placeholder?.type === 'title')
  const words = title?.text == null ? '' : textOfBody(title.text).trim()
  return words === '' ? 'Untitled' : words
}

const textOf = (shape: Shape): string => (shape.text === null ? '' : textOfBody(shape.text).trim())

const nameOf = (shape: Shape): string => (shape.name === '' ? 'Shape' : shape.name)

const sameBox = (one: Transform | null, two: Transform | null): boolean =>
  one === null || two === null
    ? one === two
    : one.x === two.x && one.y === two.y && one.width === two.width && one.height === two.height

/** The shapes of a slide by their id, which is unique within the part. */
const byId = (slide: Slide): Map<number, Shape> =>
  new Map(flatten(slide.shapes).map((shape) => [shape.id, shape]))

/**
 * Everything the other deck says differently.
 *
 * Read in the order a person would go through them: slide by slide, and within
 * a slide the shapes in the order they are drawn.
 */
export function compareDecks(mine: Deck, theirs: Deck): Change[] {
  const changes: Change[] = []
  const ours = slideIds(mine)
  const yours = slideIds(theirs)

  for (const [id, slide] of yours) {
    if (!ours.has(id)) {
      changes.push({ kind: 'slide-added', slide: Number(id) + 1, title: titleOf(slide) })
    }
  }

  for (const [id, slide] of ours) {
    if (!yours.has(id)) {
      changes.push({ kind: 'slide-removed', slide: Number(id) + 1, title: titleOf(slide) })
      continue
    }

    const other = yours.get(id)
    if (other === undefined) continue

    const here = byId(slide)
    const there = byId(other)
    const number = Number(id) + 1

    for (const [shapeId, shape] of here) {
      const match = there.get(shapeId)
      if (match === undefined) {
        changes.push({
          kind: 'shape-removed',
          slide: number,
          shapeId,
          name: nameOf(shape),
        })
        continue
      }

      if (textOf(shape) !== textOf(match)) {
        changes.push({
          kind: 'text',
          slide: number,
          shapeId,
          name: nameOf(shape),
          from: textOf(shape),
          to: textOf(match),
        })
      }

      if (!sameBox(shape.transform, match.transform) && match.transform !== null) {
        changes.push({
          kind: 'moved',
          slide: number,
          shapeId,
          name: nameOf(shape),
          to: match.transform,
        })
      }
    }

    for (const [shapeId, shape] of there) {
      if (!here.has(shapeId)) {
        changes.push({ kind: 'shape-added', slide: number, shapeId, name: nameOf(shape) })
      }
    }
  }

  return changes
}

/** The `p:txBody` of a shape, which is where its words live. */
const bodyOf = (shape: Shape): XmlNode | undefined => findChild(shape.node, 'p:txBody')

/**
 * Takes one change into this deck.
 *
 * Only the ones that live inside a slide both decks have. Bringing a whole
 * slide across means bringing its layout, its pictures and the relationships
 * that name them — the clipboard's problem at slide scale, and its own piece of
 * work rather than a branch of this one.
 */
export function applyChange(mine: Deck, theirs: Deck, change: Change): boolean {
  if (!applicable(change)) return false

  const slide = mine.slides[change.slide - 1]
  const other = theirs.slides[change.slide - 1]
  if (slide === undefined || other === undefined) return false

  const here = byId(slide).get(change.shapeId)
  const there = byId(other).get(change.shapeId)

  switch (change.kind) {
    case 'text': {
      const body = here === undefined ? undefined : bodyOf(here)
      const wanted = there === undefined ? undefined : bodyOf(there)
      if (body === undefined || wanted === undefined) return false

      // The whole body, not the words: their formatting came with their text,
      // and taking one without the other would be an edit nobody made.
      const nodes = children(body)
      nodes.length = 0
      nodes.push(...structuredClone(children(wanted)))
      return true
    }

    case 'moved':
      return here === undefined
        ? false
        : writeTransform(here, { ...change.to, child: here.transform?.child ?? null })

    case 'shape-added': {
      if (there === undefined) return false
      // Their node, cloned: everything about it comes across, including what
      // this app does not model.
      children(slide.tree).push(structuredClone(there.node))
      return true
    }

    case 'shape-removed': {
      if (here === undefined) return false
      const nodes = children(slide.tree)
      const at = nodes.indexOf(here.node)
      if (at === -1) return false

      nodes.splice(at, 1)
      return true
    }

    default:
      return false
  }
}

/** What a change says it did, in the words a person reviewing would use. */
export function describeChange(change: Change): string {
  switch (change.kind) {
    case 'slide-added':
      return `Slide ${String(change.slide)} added — ${change.title}`
    case 'slide-removed':
      return `Slide ${String(change.slide)} removed — ${change.title}`
    case 'text':
      return `${change.name}: “${change.from}” → “${change.to}”`
    case 'moved':
      return `${change.name} moved`
    case 'shape-added':
      return `${change.name} added`
    case 'shape-removed':
      return `${change.name} removed`
  }
}
