import { children, findChild } from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { textOfBody } from '@orangery/ooxml-drawingml'
import type { Deck, Slide } from './deck'
import { flatten } from './shape-tree'
import type { Shape, Transform } from './shape-tree'
import { writeTransform } from './write-shape'
import { removeSlide } from './add-slide'
import { importSlide } from './import-slide'
import { readPresentation } from './presentation'

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

/**
 * What every change says about where it is.
 *
 * `slide` is the position a person sees, counting from one, in whichever deck
 * the change is about — theirs for a slide they added, mine for everything
 * else. `slideId` is what the deck calls that slide, and is what anything
 * acting on the change looks it up by: the two decks agree on the id and need
 * not agree on the position.
 */
interface Where {
  slide: number
  slideId: string
}

export type Change =
  | ({ kind: 'slide-added'; title: string } & Where)
  | ({ kind: 'slide-removed'; title: string } & Where)
  | ({ kind: 'text'; shapeId: number; name: string; from: string; to: string } & Where)
  | ({ kind: 'moved'; shapeId: number; name: string; to: Transform } & Where)
  | ({ kind: 'shape-added'; shapeId: number; name: string } & Where)
  | ({ kind: 'shape-removed'; shapeId: number; name: string } & Where)

/** A change that happens inside a slide both decks have. */
export type ShapeChange = Extract<Change, { shapeId: number }>

/** Whether a change is about a shape, which is applied differently from a slide. */
export function isShapeChange(change: Change): change is ShapeChange {
  return change.kind !== 'slide-added' && change.kind !== 'slide-removed'
}

/**
 * The slides of a deck by the id `p:sldIdLst` gives them.
 *
 * A copy of a deck keeps those ids through every edit; positions it does not.
 * Pairing slide four with slide four after somebody inserted one would report
 * every slide in the deck as changed.
 */
function slideIds(deck: Deck): Map<string, Slide> {
  return new Map(deck.slides.map((slide) => [slide.id, slide]))
}

/** Where a slide sits in its deck, counting from one. */
const positionOf = (deck: Deck, slide: Slide): number => deck.slides.indexOf(slide) + 1

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
      changes.push({
        kind: 'slide-added',
        slide: positionOf(theirs, slide),
        slideId: id,
        title: titleOf(slide),
      })
    }
  }

  for (const [id, slide] of ours) {
    const number = positionOf(mine, slide)

    if (!yours.has(id)) {
      changes.push({ kind: 'slide-removed', slide: number, slideId: id, title: titleOf(slide) })
      continue
    }

    const other = yours.get(id)
    if (other === undefined) continue

    const here = byId(slide)
    const there = byId(other)

    for (const [shapeId, shape] of here) {
      const match = there.get(shapeId)
      if (match === undefined) {
        changes.push({
          kind: 'shape-removed',
          slide: number,
          slideId: id,
          shapeId,
          name: nameOf(shape),
        })
        continue
      }

      if (textOf(shape) !== textOf(match)) {
        changes.push({
          kind: 'text',
          slide: number,
          slideId: id,
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
          slideId: id,
          shapeId,
          name: nameOf(shape),
          to: match.transform,
        })
      }
    }

    for (const [shapeId, shape] of there) {
      if (!here.has(shapeId)) {
        changes.push({
          kind: 'shape-added',
          slide: number,
          slideId: id,
          shapeId,
          name: nameOf(shape),
        })
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
 * The ones that live inside a slide both decks have; a change about a whole
 * slide is a change to the package rather than to the model, and is applied by
 * `applySlideChange`.
 */
export function applyChange(mine: Deck, theirs: Deck, change: Change): boolean {
  if (!isShapeChange(change)) return false

  const slide = slideIds(mine).get(change.slideId)
  const other = slideIds(theirs).get(change.slideId)
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

/**
 * Takes a change about a whole slide.
 *
 * Not the model but the package: a slide is a part, with its own relationships,
 * its own content type and an entry in the list that decides the order, and
 * none of those are in the shape tree. Accepting one they added means importing
 * it with everything it names; accepting one they removed means dropping ours.
 *
 * The slide is placed where it sits in their deck. That is the only place it
 * can go: it is between two slides there, and those two are the only thing that
 * says anything about where it belongs.
 */
export function applySlideChange(into: OoxmlPackage, from: OoxmlPackage, change: Change): boolean {
  switch (change.kind) {
    case 'slide-added': {
      const source = readPresentation(from).slides.find((slide) => slide.id === change.slideId)
      return source === undefined
        ? false
        : importSlide(into, from, source.path, change.slide - 1) !== null
    }

    case 'slide-removed': {
      const index = readPresentation(into).slides.findIndex((slide) => slide.id === change.slideId)
      return index === -1 ? false : removeSlide(into, index)
    }

    default:
      return false
  }
}
