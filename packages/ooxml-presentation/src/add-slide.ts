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
  resolveTarget,
  serializeRelationships,
  setPartText,
  tagName,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import type { Deck, SlidePart } from './deck'
import { relsPartFor } from './insert-picture'
import {
  NOTES_SLIDE_RELATIONSHIP,
  PRESENTATION_PART,
  PRESENTATION_RELS_PART,
  SLIDE_LAYOUT_RELATIONSHIP,
  SLIDE_RELATIONSHIP,
} from './parts'
import { relationshipTarget } from './presentation'
import { syncSections } from './sections'

/**
 * Adding, duplicating, deleting and reordering slides.
 *
 * Every one of them puts the section list back in step afterwards: sections are
 * runs over this list, so a change here is a change there, and a deck where the
 * two disagree is one PowerPoint shows slides missing from every section.
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
  addRelationship(relationships, SLIDE_LAYOUT_RELATIONSHIP, relativeTo(path, layout.path))
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
  syncSections(pkg)
  return { path, index }
}

/** One part's path as another part's relationship states it. */
function relativeTo(fromPath: string, toPath: string): string {
  const from = fromPath.split('/').slice(0, -1)
  const to = toPath.split('/')

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
  syncSections(pkg)
  return true
}

/**
 * Moves several slides at once, keeping their order among themselves.
 *
 * `to` is the slide they were dropped on: the block lands before it when it
 * came from below and after it when it came from above, which is the side the
 * drop line was drawn on. Dropping a block on one of its own slides does
 * nothing — there is no position that would be a move.
 *
 * Returns where the block landed, or null when nothing moved.
 */
export function moveSlides(
  pkg: OoxmlPackage,
  indexes: readonly number[],
  to: number,
): { index: number } | null {
  const found = presentationRoot(pkg)
  const list = found === null ? undefined : findChild(found.root, 'p:sldIdLst')
  if (found === null || list === undefined) return null

  const entries = children(list)
  const moving = [...new Set(indexes)]
    .filter((index) => index >= 0 && index < entries.length)
    .sort((first, second) => first - second)

  const highest = moving.at(-1)
  if (highest === undefined || moving.includes(to) || to < 0 || to >= entries.length) return null

  const picked = new Set(moving)
  const rest = entries.filter((_, index) => !picked.has(index))
  const above = entries.filter((_, index) => !picked.has(index) && index < to).length
  const position = to > highest ? above + 1 : above

  rest.splice(
    position,
    0,
    ...moving.flatMap((index) => {
      const entry = entries[index]
      return entry === undefined ? [] : [entry]
    }),
  )
  entries.splice(0, entries.length, ...rest)

  writePresentation(pkg, found.roots)
  syncSections(pkg)
  return { index: position }
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
  syncSections(pkg)
  return true
}

const NOTES_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml'

/** The next free `nameN.xml` in a directory, so a new part never lands on an existing one. */
function nextPartName(pkg: OoxmlPackage, directory: string, stem: string): string {
  const pattern = new RegExp(`^${directory}/${stem}(\\d+)\\.xml$`, 'u')

  let highest = 0
  for (const path of pkg.parts.keys()) {
    const match = pattern.exec(path)
    if (match?.[1] !== undefined) highest = Math.max(highest, Number(match[1]))
  }
  return `${stem}${String(highest + 1)}.xml`
}

/**
 * Copies the notes page of a slide onto the copy of that slide.
 *
 * Without this the two slides would share one notes part, and typing notes on
 * the copy would rewrite the original's. The notes page names its slide in its
 * own relationships, so that one is repointed; everything else is carried over
 * as it was.
 */
function duplicateNotes(pkg: OoxmlPackage, notesPath: string, slidePath: string): string | null {
  const text = getPartText(pkg, notesPath)
  if (text === undefined) return null

  const name = nextPartName(pkg, 'ppt/notesSlides', 'notesSlide')
  const path = `ppt/notesSlides/${name}`
  setPartText(pkg, path, text)
  ensureOverride(pkg, path, NOTES_CONTENT_TYPE)

  const relationships = parseRelationships(getPartText(pkg, relsPartFor(notesPath)) ?? '')
  for (const [id, relationship] of relationships) {
    if (relationship.type !== SLIDE_RELATIONSHIP) continue
    relationships.set(id, { ...relationship, target: relativeTo(path, slidePath) })
  }
  setPartText(pkg, relsPartFor(path), serializeRelationships(relationships))

  return path
}

/**
 * Copies a slide, with everything on it.
 *
 * The part is copied as text rather than rebuilt from the model — the same
 * reasoning as duplicating a shape, one level up: whatever the file holds that
 * we never modelled comes with it. Its relationships are copied too, so the
 * copy points at the same layout and the same pictures; media is shared rather
 * than duplicated, which is what PowerPoint does and what keeps a deck of
 * copies from growing by a megabyte each time. The notes page is the exception,
 * because it is the one part that belongs to this slide alone.
 */
export function duplicateSlide(pkg: OoxmlPackage, index: number): AddedSlide | null {
  const found = presentationRoot(pkg)
  const list = found === null ? undefined : findChild(found.root, 'p:sldIdLst')
  if (found === null || list === undefined) return null

  const entries = children(list)
  const entry = entries[index]
  if (entry === undefined) return null

  const id = attribute(entry, 'r:id') ?? null
  const sourcePath = id === null ? null : relationshipTarget(pkg, PRESENTATION_PART, id)
  const text = sourcePath === null ? undefined : getPartText(pkg, sourcePath)
  if (sourcePath === null || text === undefined) return null

  const name = nextSlideName(pkg)
  const path = `ppt/slides/${name}`
  setPartText(pkg, path, text)
  ensureOverride(pkg, path, SLIDE_CONTENT_TYPE)

  // The copy's own relationships, as they were: same layout, same media.
  const relationships = parseRelationships(getPartText(pkg, relsPartFor(sourcePath)) ?? '')
  for (const [relationshipId, relationship] of relationships) {
    if (relationship.type !== NOTES_SLIDE_RELATIONSHIP) continue

    const notes = duplicateNotes(pkg, resolveTarget(relationship.target, 'ppt/slides'), path)
    if (notes === null) relationships.delete(relationshipId)
    else relationships.set(relationshipId, { ...relationship, target: relativeTo(path, notes) })
  }
  setPartText(pkg, relsPartFor(path), serializeRelationships(relationships))

  const presentationRels = parseRelationships(getPartText(pkg, PRESENTATION_RELS_PART) ?? '')
  const relationship = addRelationship(presentationRels, SLIDE_RELATIONSHIP, `slides/${name}`)
  setPartText(pkg, PRESENTATION_RELS_PART, serializeRelationships(presentationRels))

  entries.splice(
    index + 1,
    0,
    element('p:sldId', { id: String(nextSlideId(list)), 'r:id': relationship.id }),
  )

  writePresentation(pkg, found.roots)
  syncSections(pkg)
  return { path, index: index + 1 }
}

/**
 * Copies several slides at once.
 *
 * The copies go after the last one selected, in the order they were in, which
 * is where PowerPoint puts them — one copy tucked in behind each original would
 * interleave the two halves of a section and lose the reason they were picked
 * together. Each copy is made where its original is and then moved into place,
 * so no original ever shifts under the next copy.
 */
export function duplicateSlides(
  pkg: OoxmlPackage,
  indexes: readonly number[],
): { paths: string[]; index: number } | null {
  const sorted = [...new Set(indexes)].sort((first, second) => first - second)
  const last = sorted.at(-1)
  if (last === undefined) return null

  const paths: string[] = []
  for (const source of sorted) {
    const copy = duplicateSlide(pkg, source)
    if (copy === null) continue

    const destination = last + 1 + paths.length
    if (copy.index !== destination) moveSlide(pkg, copy.index, destination)
    paths.push(copy.path)
  }

  return paths.length === 0 ? null : { paths, index: last + 1 }
}

/**
 * Removes several slides at once.
 *
 * Highest first, so each removal leaves the indexes below it alone. A deck with
 * no slides is one PowerPoint will not open, so removing every slide does
 * nothing at all rather than part of what was asked.
 */
export function removeSlides(pkg: OoxmlPackage, indexes: readonly number[]): boolean {
  const found = presentationRoot(pkg)
  const list = found === null ? undefined : findChild(found.root, 'p:sldIdLst')
  if (found === null || list === undefined) return false

  const total = children(list).length
  const sorted = [...new Set(indexes)]
    .filter((index) => index >= 0 && index < total)
    .sort((first, second) => second - first)

  if (sorted.length === 0 || sorted.length >= total) return false

  for (const index of sorted) removeSlide(pkg, index)
  return true
}

/**
 * Puts a slide on a different layout.
 *
 * Only the relationship changes. A placeholder names what it is — a title, the
 * second body — and resolves against whichever layout the slide points at, so
 * the content stays and takes the new layout's geometry and styling. A shape
 * the new layout has no placeholder for keeps whatever it states itself, which
 * is the same answer PowerPoint gives.
 */
export function setSlideLayout(pkg: OoxmlPackage, slide: SlidePart, layout: SlidePart): boolean {
  const relsPart = relsPartFor(slide.path)
  const relationships = parseRelationships(getPartText(pkg, relsPart) ?? '')

  const existing = [...relationships.values()].find(
    (relationship) => relationship.type === SLIDE_LAYOUT_RELATIONSHIP,
  )
  if (existing === undefined) return false

  const target = relativeTo(slide.path, layout.path)
  if (existing.target === target) return false

  relationships.set(existing.id, { ...existing, target })
  setPartText(pkg, relsPart, serializeRelationships(relationships))
  return true
}
