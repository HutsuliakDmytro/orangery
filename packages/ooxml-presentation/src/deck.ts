import { findChild, getPartText, parseXml, tagName } from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { readPresentation } from './presentation'
import type { PresentationMap, SlideSize } from './presentation'
import { parseShapeTree } from './shape-tree'
import type { Shape } from './shape-tree'

/**
 * The deck as a tree: `Presentation → Master[] → Layout[] → Slide[]`.
 *
 * Slides, layouts and masters are the same thing structurally — a part holding
 * a `p:spTree` — and differ in what they mean. That similarity is the whole
 * basis of placeholder inheritance, so it is modelled rather than worked
 * around: a title looks up its layout's shape of the same placeholder type, and
 * that looks up the master's.
 *
 * Nothing here resolves inheritance or draws anything. It answers "what is in
 * this deck", and every part keeps the node it was read from.
 */

/** A part that holds a shape tree: a slide, a layout or a master. */
export interface SlidePart {
  path: string
  /** The root element, `p:sld` / `p:sldLayout` / `p:sldMaster`. */
  root: XmlNode
  /** The `p:spTree`, which is what a write patches into. */
  tree: XmlNode
  shapes: Shape[]
}

export interface Slide extends SlidePart {
  /** The layout this slide is built on; null only in a malformed deck. */
  layout: string | null
  notes: string | null
}

export interface Master extends SlidePart {
  layouts: string[]
  theme: string | null
}

export interface Deck {
  slideSize: SlideSize
  notesSize: SlideSize
  slides: Slide[]
  /** Keyed by part path, which is how a slide names its layout. */
  layouts: Map<string, SlidePart>
  masters: Map<string, Master>
  /** The part map this was built from, for anything that needs to walk it again. */
  map: PresentationMap
}

const ROOTS = new Set(['p:sld', 'p:sldLayout', 'p:sldMaster', 'p:notes'])

/** Reads a part that holds a shape tree, or null when the part is missing. */
export function readSlidePart(pkg: OoxmlPackage, path: string): SlidePart | null {
  const text = getPartText(pkg, path)
  if (text === undefined) return null

  const root = parseXml(text).find((node) => ROOTS.has(tagName(node) ?? ''))
  if (root === undefined) return null

  // `p:cSld` is where the common slide data lives, shape tree included; a slide
  // has other children beside it (timing, transition) that are not shapes.
  const common = findChild(root, 'p:cSld')
  const tree = common === undefined ? undefined : findChild(common, 'p:spTree')
  if (tree === undefined) return null

  return { path, root, tree, shapes: parseShapeTree(tree) }
}

export function readDeck(pkg: OoxmlPackage): Deck {
  const map = readPresentation(pkg)

  const layouts = new Map<string, SlidePart>()
  const masters = new Map<string, Master>()

  for (const master of map.masters) {
    const part = readSlidePart(pkg, master.path)
    if (part !== null) {
      masters.set(master.path, { ...part, layouts: master.layouts, theme: master.theme })
    }

    // Every layout the master offers is read, not only the ones a slide uses:
    // changing a slide's layout later picks from all of them.
    for (const path of master.layouts) {
      if (layouts.has(path)) continue
      const layout = readSlidePart(pkg, path)
      if (layout !== null) layouts.set(path, layout)
    }
  }

  const slides = map.slides.flatMap((entry) => {
    const part = readSlidePart(pkg, entry.path)
    return part === null ? [] : [{ ...part, layout: entry.layout, notes: entry.notes }]
  })

  return { slideSize: map.slideSize, notesSize: map.notesSize, slides, layouts, masters, map }
}

/** The layout a slide is built on, or null when the deck does not say. */
export function layoutOf(deck: Deck, slide: Slide): SlidePart | null {
  return slide.layout === null ? null : (deck.layouts.get(slide.layout) ?? null)
}

/** The master behind a layout, found by which master offers it. */
export function masterOf(deck: Deck, layout: SlidePart): Master | null {
  for (const master of deck.masters.values()) {
    if (master.layouts.includes(layout.path)) return master
  }
  return null
}
