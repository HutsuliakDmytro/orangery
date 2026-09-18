import {
  addRelationship,
  attribute,
  buildXml,
  children,
  element,
  ensureOverride,
  findChild,
  getPartText,
  parseRelationships,
  parseXml,
  serializeRelationships,
  setPartText,
  tagName,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import type { Deck, SlidePart } from './deck'
import { relsPartFor } from './insert-picture'
import {
  PRESENTATION_PART,
  PRESENTATION_RELS_PART,
  SLIDE_LAYOUT_RELATIONSHIP,
  SLIDE_RELATIONSHIP,
} from './parts'

/**
 * Adding, duplicating, deleting and reordering slides.
 *
 * A slide is not a node in a document — it is a part of the package, and five
 * things have to agree about it: the part itself, its own relationships, the
 * content type naming it, a relationship from `presentation.xml`, and an entry
 * in `p:sldIdLst`. The order slides are presented in comes from that list and
 * from nothing else, which is why reordering never touches the parts.
 */

const SLIDE_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml'

/** Slide ids start at 256 in every deck PowerPoint writes. */
const FIRST_SLIDE_ID = 256

function presentationRoot(pkg: OoxmlPackage): { roots: XmlNode[]; root: XmlNode } | null {
  const roots = parseXml(getPartText(pkg, PRESENTATION_PART) ?? '')
  const root = roots.find((node) => tagName(node) === 'p:presentation')
  return root === undefined ? null : { roots, root }
}

function writePresentation(pkg: OoxmlPackage, roots: XmlNode[]): void {
  setPartText(pkg, PRESENTATION_PART, withDeclaration(buildXml(roots)))
}

/** The next free `slideN.xml`, so a new part never lands on an existing one. */
function nextSlideName(pkg: OoxmlPackage): string {
  let highest = 0
  for (const path of pkg.parts.keys()) {
    const match = /^ppt\/slides\/slide(\d+)\.xml$/u.exec(path)
    if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]))
  }
  return `slide${String(highest + 1)}.xml`
}

/** The next free id for `p:sldId`, which is not the same as the part number. */
function nextSlideId(list: XmlNode): number {
  const used = children(list)
    .filter((child) => tagName(child) === 'p:sldId')
    .map((child) => Number(attribute(child, 'id')))
    .filter((id) => Number.isFinite(id))

  return Math.max(FIRST_SLIDE_ID - 1, ...used) + 1
}

/**
 * The placeholders a new slide starts with.
 *
 * Copied from the layout, emptied of text. The date, footer and slide number
 * are left behind: they are drawn from the layout and the master, and a copy on
 * the slide would be a second one that stops following them.
 */
function placeholdersFrom(layout: SlidePart): XmlNode[] {
  const furniture = new Set(['dt', 'ftr', 'sldNum'])

  return children(layout.tree)
    .filter((child) => tagName(child) === 'p:sp')
    .flatMap((shape) => {
      const nonVisual = findChild(shape, 'p:nvSpPr')
      const properties = nonVisual === undefined ? undefined : findChild(nonVisual, 'p:nvPr')
      const ph = properties === undefined ? undefined : findChild(properties, 'p:ph')
      if (ph === undefined) return []
      if (furniture.has(attribute(ph, 'type') ?? '')) return []

      const copy = structuredClone(shape)
      emptyText(copy)
      return [copy]
    })
}

/** Removes the runs from a shape's text body, leaving the body and its style. */
function emptyText(shape: XmlNode): void {
  const body = findChild(shape, 'p:txBody')
  if (body === undefined) return

  const kept = children(body).filter((child) => {
    const tag = tagName(child)
    return tag === 'a:bodyPr' || tag === 'a:lstStyle'
  })

  const nodes = children(body)
  nodes.length = 0
  // One empty paragraph: a text body with none is a file PowerPoint refuses.
  nodes.push(...kept, element('a:p'))
}

export interface AddedSlide {
  path: string
  /** Where it landed in the deck, counting from zero. */
  index: number
}

/**
 * Adds a slide built on a layout, after the one at `after`.
 *
 * Returns null when the deck has no layout to build on, which is a deck we
 * could not have opened.
 */
export function addSlide(
  pkg: OoxmlPackage,
  deck: Deck,
  layout: SlidePart,
  after: number,
): AddedSlide | null {
  const found = presentationRoot(pkg)
  if (found === null) return null

  const list = findChild(found.root, 'p:sldIdLst')
  if (list === undefined) return null

  const name = nextSlideName(pkg)
  const path = `ppt/slides/${name}`

  const tree = element('p:spTree', {}, [
    element('p:nvGrpSpPr', {}, [
      element('p:cNvPr', { id: '1', name: '' }),
      element('p:cNvGrpSpPr'),
      element('p:nvPr'),
    ]),
    element('p:grpSpPr'),
    ...placeholdersFrom(layout),
  ])

  const root = element('p:sld', {}, [element('p:cSld', {}, [tree])])
  setPartText(pkg, path, withDeclaration(buildXml([root])))

  // Its own relationships: a slide points at the layout it is built on.
  const relationships = parseRelationships('')
  addRelationship(relationships, SLIDE_LAYOUT_RELATIONSHIP, relativeLayout(path, layout.path))
  setPartText(pkg, relsPartFor(path), serializeRelationships(relationships))

  ensureOverride(pkg, path, SLIDE_CONTENT_TYPE)

  // The presentation's relationship, and the entry that decides the order.
  const presentationRels = parseRelationships(getPartText(pkg, PRESENTATION_RELS_PART) ?? '')
  const relationship = addRelationship(presentationRels, SLIDE_RELATIONSHIP, `slides/${name}`)
  setPartText(pkg, PRESENTATION_RELS_PART, serializeRelationships(presentationRels))

  const entry = element('p:sldId', {
    id: String(nextSlideId(list)),
    'r:id': relationship.id,
  })
  const index = Math.min(Math.max(after + 1, 0), deck.slides.length)
  children(list).splice(index, 0, entry)

  writePresentation(pkg, found.roots)
  return { path, index }
}

/** A layout's path as a slide's relationship states it. */
function relativeLayout(slidePath: string, layoutPath: string): string {
  const from = slidePath.split('/').slice(0, -1)
  const to = layoutPath.split('/')

  let shared = 0
  while (shared < from.length && from[shared] === to[shared]) shared += 1

  return [...Array.from({ length: from.length - shared }, () => '..'), ...to.slice(shared)].join(
    '/',
  )
}

/** Moves a slide within the deck. Returns false when it was already there. */
export function moveSlide(pkg: OoxmlPackage, from: number, to: number): boolean {
  const found = presentationRoot(pkg)
  const list = found === null ? undefined : findChild(found.root, 'p:sldIdLst')
  if (found === null || list === undefined) return false

  const entries = children(list)
  const moving = entries[from]
  if (moving === undefined || from === to || to < 0 || to >= entries.length) return false

  entries.splice(from, 1)
  entries.splice(to, 0, moving)

  writePresentation(pkg, found.roots)
  return true
}

/**
 * Removes a slide from the deck.
 *
 * The part is left in the package. A slide nobody can reach is not a slide, and
 * removing the bytes would take the media only it used with it — which is a
 * much larger question than this operation.
 */
export function removeSlide(pkg: OoxmlPackage, index: number): boolean {
  const found = presentationRoot(pkg)
  const list = found === null ? undefined : findChild(found.root, 'p:sldIdLst')
  if (found === null || list === undefined) return false

  const entries = children(list)
  if (index < 0 || index >= entries.length || entries.length === 1) return false

  entries.splice(index, 1)
  writePresentation(pkg, found.roots)
  return true
}
