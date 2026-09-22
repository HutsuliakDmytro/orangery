import {
  attribute,
  findChild,
  findChildren,
  getPartText,
  partDirectory,
  parseRelationships,
  parseXml,
  resolveTarget,
  tagName,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, Relationship, XmlNode } from '@orangery/ooxml-core'
import {
  COMMENT_AUTHORS_RELATIONSHIP,
  COMMENTS_RELATIONSHIP,
  HANDOUT_MASTER_RELATIONSHIP,
  MEDIA_RELATIONSHIPS,
  MODERN_COMMENT_AUTHORS_RELATIONSHIP,
  MODERN_COMMENTS_RELATIONSHIPS,
  NOTES_MASTER_RELATIONSHIP,
  NOTES_SLIDE_RELATIONSHIP,
  presentationPart,
  SLIDE_LAYOUT_RELATIONSHIP,
  THEME_RELATIONSHIP,
} from './parts'

/**
 * How the parts of a deck find each other.
 *
 * Nothing here is rendered or edited; this is the map. `presentation.xml` lists
 * masters and slides by relationship id, each slide's own rels name its layout
 * and its notes, and each master's name its layouts and its theme. Walking that
 * graph once up front means the rest of the code can ask for "the layout of
 * slide 3" without re-reading rels files.
 */

/** Dimensions in EMU, as the file states them. */
export interface SlideSize {
  width: number
  height: number
}

export interface SlideParts {
  /** Path in the package, e.g. `ppt/slides/slide1.xml`. */
  path: string
  /**
   * `p:sldId/@id` — what the deck calls this slide.
   *
   * Stable across every edit, which the position is not: inserting one slide
   * renumbers every slide after it. Anything that has to recognise the same
   * slide in a copy of the deck matches on this.
   */
  id: string
  /** The layout this slide is built on; null only in a malformed deck. */
  layout: string | null
  /** The notes page, when the slide has one. */
  notes: string | null
  /**
   * The comment parts on this slide, old and modern.
   *
   * Both, because a deck edited by two versions of PowerPoint has both, and a
   * reader that knew only one would report half a conversation.
   */
  comments: string[]
}

export interface MasterParts {
  path: string
  /** Every layout the master offers, whether or not a slide uses one. */
  layouts: string[]
  theme: string | null
}

export interface PresentationMap {
  /** Slides in `sldIdLst` order, which is the order they are presented in. */
  slides: SlideParts[]
  masters: MasterParts[]
  notesMaster: string | null
  /**
   * The handout master, which decides what several slides on one page look
   * like. Rare, and a deck that has one is a deck somebody meant to print.
   */
  handoutMaster: string | null
  /** `commentAuthors.xml` — the people, which the whole deck shares. */
  commentAuthors: string[]
  /**
   * Every picture, film and sound any part of the deck points at.
   *
   * Gathered by walking the parts rather than by listing the `ppt/media`
   * directory: what is in that directory and what the deck uses are two
   * different questions, and only the second one means anything.
   */
  media: string[]
  slideSize: SlideSize
  notesSize: SlideSize
  /**
   * `p:presentation/@firstSlideNum` — what the first slide is numbered.
   *
   * One almost always, and not always: a deck that continues another one starts
   * where that one stopped, and every slide number on it is then off by the
   * difference if this is ignored.
   */
  firstSlideNum: number
}

/** A part's relationships, resolved to package paths. */
function relationshipsOf(pkg: OoxmlPackage, path: string): Relationship[] {
  const directory = partDirectory(path)
  const relsPath = `${directory}/_rels/${path.slice(directory.length + 1)}.rels`
  const text = getPartText(pkg, relsPath)
  if (text === undefined) return []

  return [...parseRelationships(text).values()].map((relationship) => ({
    ...relationship,
    target: relationship.external
      ? relationship.target
      : resolveTarget(relationship.target, directory),
  }))
}

function firstTargetOf(relationships: Relationship[], type: string): string | null {
  return relationships.find((relationship) => relationship.type === type)?.target ?? null
}

function targetsOf(relationships: Relationship[], type: string): string[] {
  return relationships
    .filter((relationship) => relationship.type === type)
    .map((relationship) => relationship.target)
}

/**
 * Reads a size element.
 *
 * `p:sldSz` carries a `type` attribute — `screen4x3`, `screen16x9` — that looks
 * authoritative and is not: it is a label for the preset the size came from,
 * and generators leave it stale when the dimensions change. The dimensions are
 * the truth.
 */
function sizeOf(root: XmlNode | undefined, tag: string, fallback: SlideSize): SlideSize {
  const element = root === undefined ? undefined : findChild(root, tag)
  if (element === undefined) return fallback

  const width = Number(attribute(element, 'cx'))
  const height = Number(attribute(element, 'cy'))

  return {
    width: Number.isFinite(width) && width > 0 ? width : fallback.width,
    height: Number.isFinite(height) && height > 0 ? height : fallback.height,
  }
}

/** An attribute read as a number, or the fallback when it is absent or junk. */
function numberOf(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** PowerPoint's own default, used when a deck does not say. */
const DEFAULT_SLIDE_SIZE: SlideSize = { width: 12192000, height: 6858000 }
const DEFAULT_NOTES_SIZE: SlideSize = { width: 6858000, height: 9144000 }

/**
 * Resolves the ids in a list element against the presentation's relationships.
 *
 * Order matters and comes from the list, not from the rels file: `sldIdLst` is
 * what decides slide 1 from slide 2, and rels are in whatever order they were
 * written.
 */
function orderedTargets(
  presentation: XmlNode | undefined,
  listTag: string,
  itemTag: string,
  relationships: Relationship[],
): string[] {
  return orderedEntries(presentation, listTag, itemTag, relationships).map((entry) => entry.target)
}

/** The same, keeping the id the list gives each entry. */
function orderedEntries(
  presentation: XmlNode | undefined,
  listTag: string,
  itemTag: string,
  relationships: Relationship[],
): { id: string; target: string }[] {
  const list = presentation === undefined ? undefined : findChild(presentation, listTag)
  if (list === undefined) return []

  const byId = new Map(relationships.map((relationship) => [relationship.id, relationship.target]))

  return findChildren(list, itemTag).flatMap((item) => {
    const target = byId.get(attribute(item, 'r:id') ?? '')
    return target === undefined ? [] : [{ id: attribute(item, 'id') ?? '', target }]
  })
}

export function readPresentation(pkg: OoxmlPackage): PresentationMap {
  const root = parseXml(getPartText(pkg, presentationPart(pkg)) ?? '').find(
    (node) => tagName(node) === 'p:presentation',
  )
  const relationships = relationshipsOf(pkg, presentationPart(pkg))

  const slides = orderedEntries(root, 'p:sldIdLst', 'p:sldId', relationships).map((entry) => {
    const path = entry.target
    const own = relationshipsOf(pkg, path)
    return {
      path,
      id: entry.id,
      layout: firstTargetOf(own, SLIDE_LAYOUT_RELATIONSHIP),
      notes: firstTargetOf(own, NOTES_SLIDE_RELATIONSHIP),
      comments: [
        ...targetsOf(own, COMMENTS_RELATIONSHIP),
        ...MODERN_COMMENTS_RELATIONSHIPS.flatMap((type) => targetsOf(own, type)),
      ],
    }
  })

  const masters = orderedTargets(root, 'p:sldMasterIdLst', 'p:sldMasterId', relationships).map(
    (path) => {
      const own = relationshipsOf(pkg, path)
      return {
        path,
        layouts: targetsOf(own, SLIDE_LAYOUT_RELATIONSHIP),
        theme: firstTargetOf(own, THEME_RELATIONSHIP),
      }
    },
  )

  const notesMaster = firstTargetOf(relationships, NOTES_MASTER_RELATIONSHIP)
  const handoutMaster = firstTargetOf(relationships, HANDOUT_MASTER_RELATIONSHIP)

  // Every part that can point at a picture: the slides and what they inherit
  // from, the notes and the two masters that are not slide masters.
  const carriers = [
    presentationPart(pkg),
    ...slides.flatMap((slide) => [slide.path, ...(slide.notes === null ? [] : [slide.notes])]),
    ...masters.flatMap((master) => [master.path, ...master.layouts]),
    ...(notesMaster === null ? [] : [notesMaster]),
    ...(handoutMaster === null ? [] : [handoutMaster]),
  ]

  const media = new Set<string>()
  for (const part of carriers) {
    for (const relationship of relationshipsOf(pkg, part)) {
      if (relationship.external) continue
      if (MEDIA_RELATIONSHIPS.includes(relationship.type)) media.add(relationship.target)
    }
  }

  return {
    slides,
    masters,
    notesMaster,
    handoutMaster,
    commentAuthors: [
      ...targetsOf(relationships, COMMENT_AUTHORS_RELATIONSHIP),
      ...targetsOf(relationships, MODERN_COMMENT_AUTHORS_RELATIONSHIP),
    ],
    media: [...media].sort(),
    slideSize: sizeOf(root, 'p:sldSz', DEFAULT_SLIDE_SIZE),
    notesSize: sizeOf(root, 'p:notesSz', DEFAULT_NOTES_SIZE),
    firstSlideNum: numberOf(root === undefined ? undefined : attribute(root, 'firstSlideNum'), 1),
  }
}

/** Every part the map reaches, for asserting that nothing was left unaccounted for. */
export function referencedParts(map: PresentationMap): string[] {
  const parts = new Set<string>()

  for (const slide of map.slides) {
    parts.add(slide.path)
    if (slide.layout !== null) parts.add(slide.layout)
    if (slide.notes !== null) parts.add(slide.notes)
    for (const comments of slide.comments) parts.add(comments)
  }

  for (const master of map.masters) {
    parts.add(master.path)
    if (master.theme !== null) parts.add(master.theme)
    for (const layout of master.layouts) parts.add(layout)
  }

  if (map.notesMaster !== null) parts.add(map.notesMaster)
  if (map.handoutMaster !== null) parts.add(map.handoutMaster)
  for (const authors of map.commentAuthors) parts.add(authors)
  for (const one of map.media) parts.add(one)

  return [...parts].sort()
}

/**
 * The package path a relationship on a part points at.
 *
 * Every part resolves its own relationships against its own directory, which is
 * why this takes the part rather than the package alone — a slide's `rId2` and
 * a layout's `rId2` are different files.
 */
export function relationshipTarget(pkg: OoxmlPackage, part: string, id: string): string | null {
  return relationshipsOf(pkg, part).find((relationship) => relationship.id === id)?.target ?? null
}
