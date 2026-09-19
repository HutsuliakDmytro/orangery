import {
  addRelationship,
  attribute,
  children,
  contentTypeOf,
  ensureContentType,
  ensureOverride,
  findChild,
  getPartText,
  parseRelationships,
  parseXml,
  buildXml,
  element,
  resolveTarget,
  serializeRelationships,
  setAttribute,
  setPartText,
  tagName,
  upsertChild,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, Relationship, XmlNode } from '@orangery/ooxml-core'
import {
  SLIDE_CONTENT_TYPE,
  nextSlideId,
  nextSlideName,
  presentationRoot,
  relativeTo,
  writePresentation,
} from './add-slide'
import type { AddedSlide } from './add-slide'
import { relsPartFor } from './insert-picture'
import {
  NOTES_MASTER_RELATIONSHIP,
  NOTES_SLIDE_RELATIONSHIP,
  PRESENTATION_ORDER,
  PRESENTATION_PART,
  PRESENTATION_RELS_PART,
  SLIDE_LAYOUT_RELATIONSHIP,
  SLIDE_MASTER_RELATIONSHIP,
  SLIDE_RELATIONSHIP,
} from './parts'
import { readPresentation } from './presentation'
import { syncSections } from './sections'

/**
 * Taking a slide out of one deck and putting it in another.
 *
 * A slide is not the part it is written in. It names a layout, some pictures, a
 * notes page, maybe a chart with a workbook inside it — and every one of those
 * is another part of a package the other deck has and this one has never heard
 * of. So the part travels with everything reachable from it, and only the
 * relationships are rewritten: the slide's own XML is copied as text, which is
 * what keeps the animations, the extension lists and everything else nothing
 * here models.
 *
 * Three things are answered rather than copied:
 *
 * - **The layout.** A layout matching by name or by kind is used where this
 *   deck has one, which is what PowerPoint calls "use destination theme" and is
 *   its default. Only where nothing matches is the layout itself brought over,
 *   pointed at this deck's master — so a slide arrives dressed as this deck,
 *   and dragging in a master, a theme and eleven more layouts never happens.
 * - **Media.** Bytes are copied, never shared: the other package may be a file
 *   this one will never see again.
 * - **A link to another slide.** It named a slide of their deck. Where this
 *   deck has the same slide, the link is repointed at it; where it does not,
 *   the link is emptied rather than left naming a relationship that is not
 *   there — an empty `r:id` is what PowerPoint itself writes for a jump with no
 *   target, and a dangling one makes it offer to repair the file.
 */

/** What a copy in progress has to remember. */
interface Copying {
  into: OoxmlPackage
  from: OoxmlPackage
  /** Source path to where it landed, so a part shared twice is copied once. */
  done: Map<string, string>
}

/** Where a relationship's target should land, or null to drop the relationship. */
type Decide = (relationship: Relationship, resolved: string) => string | null

const directoryOf = (path: string): string => path.slice(0, path.lastIndexOf('/'))

/**
 * A path in the destination package that is not taken.
 *
 * Never reuses an existing one, however alike the names: `chart1.xml` in two
 * decks is two different charts, and landing on top of this deck's would edit a
 * slide nobody touched.
 */
function freePath(pkg: OoxmlPackage, path: string): string {
  if (!pkg.parts.has(path)) return path

  const directory = directoryOf(path)
  const name = path.slice(directory.length + 1)
  const dot = name.lastIndexOf('.')
  const extension = dot === -1 ? '' : name.slice(dot)
  const stem = (dot === -1 ? name : name.slice(0, dot)).replace(/\d+$/u, '')

  for (let number = 1; ; number += 1) {
    const candidate = `${directory}/${stem}${String(number)}${extension}`
    if (!pkg.parts.has(candidate)) return candidate
  }
}

/**
 * Declares a copied part in `[Content_Types].xml`.
 *
 * An XML part is named one by one, media by its extension: `xml` already has a
 * default, and it says `application/xml`, which a slide layout is not.
 */
function declare(context: Copying, sourcePath: string, targetPath: string): void {
  const type = contentTypeOf(context.from, sourcePath)
  if (type === null) return

  const extension = targetPath.split('.').pop()?.toLowerCase() ?? ''
  if (extension === 'xml') ensureOverride(context.into, targetPath, type)
  else ensureContentType(context.into, extension, type)
}

/** Puts the bytes of a part into the destination package, under a new name. */
function place(context: Copying, sourcePath: string, targetPath: string): void {
  const part = context.from.parts.get(sourcePath)
  if (part === undefined) return

  context.into.parts.set(targetPath, {
    path: targetPath,
    bytes: part.bytes,
    ...(part.text === undefined ? {} : { text: part.text }),
    date: new Date(),
  })
  declare(context, sourcePath, targetPath)
}

/**
 * Copies a part's relationships, rewriting each target to where it landed.
 *
 * Returns the ids that were dropped, so whoever owns the XML can stop naming
 * them. An external target — a hyperlink out of the package — travels exactly
 * as it is: it points at the web, which both decks can see.
 */
function copyRelationships(
  context: Copying,
  sourcePath: string,
  targetPath: string,
  decide: Decide,
): string[] {
  const source = parseRelationships(getPartText(context.from, relsPartFor(sourcePath)) ?? '')
  const copied = new Map<string, Relationship>()
  const dropped: string[] = []

  for (const [id, relationship] of source) {
    if (relationship.external) {
      copied.set(id, relationship)
      continue
    }

    const resolved = resolveTarget(relationship.target, directoryOf(sourcePath))
    const landed = decide(relationship, resolved)
    if (landed === null) {
      dropped.push(id)
      continue
    }

    copied.set(id, { ...relationship, target: relativeTo(targetPath, landed) })
  }

  if (copied.size > 0) {
    setPartText(context.into, relsPartFor(targetPath), serializeRelationships(copied))
  }
  return dropped
}

/**
 * Copies a part and everything it points at.
 *
 * The recursion is what makes a chart arrive whole: `chart1.xml` names a
 * workbook, a colour style and a style part, and each of those names more. The
 * map of what is already copied ends the recursion, and also the cycle a notes
 * page makes by pointing back at its slide.
 */
function copyPart(context: Copying, sourcePath: string): string | null {
  const already = context.done.get(sourcePath)
  if (already !== undefined) return already
  if (!context.from.parts.has(sourcePath)) return null

  const target = freePath(context.into, sourcePath)
  context.done.set(sourcePath, target)

  place(context, sourcePath, target)
  copyRelationships(context, sourcePath, target, (_, resolved) => copyPart(context, resolved))
  return target
}

/** `p:cSld/@name` — what PowerPoint shows a layout as in its gallery. */
function layoutName(pkg: OoxmlPackage, path: string): string | null {
  const root = parseXml(getPartText(pkg, path) ?? '').find(
    (node) => tagName(node) === 'p:sldLayout',
  )
  const common = root === undefined ? undefined : findChild(root, 'p:cSld')
  return common === undefined ? null : (attribute(common, 'name') ?? null)
}

/** `p:sldLayout/@type` — `title`, `obj`, `blank`, and the rest of the kinds. */
function layoutKind(pkg: OoxmlPackage, path: string): string | null {
  const root = parseXml(getPartText(pkg, path) ?? '').find(
    (node) => tagName(node) === 'p:sldLayout',
  )
  return root === undefined ? null : (attribute(root, 'type') ?? null)
}

/** The layout of this deck that answers to the same name, or to the same kind. */
function matchingLayout(context: Copying, sourcePath: string): string | null {
  const here = readPresentation(context.into).masters.flatMap((master) => master.layouts)

  const name = layoutName(context.from, sourcePath)
  if (name !== null) {
    const byName = here.find(
      (path) => layoutName(context.into, path)?.toLowerCase() === name.toLowerCase(),
    )
    if (byName !== undefined) return byName
  }

  const kind = layoutKind(context.from, sourcePath)
  return kind === null
    ? null
    : (here.find((path) => layoutKind(context.into, path) === kind) ?? null)
}

/** Layout ids in a master's list are large, and PowerPoint starts them here. */
const FIRST_LAYOUT_ID = 2147483649

/**
 * Puts a copied layout in its master's list.
 *
 * A layout points at its master and the master lists its layouts; a layout in
 * one direction only is a layout PowerPoint does not offer, which for a layout
 * nothing else uses is the same as not having brought it.
 */
function registerLayout(pkg: OoxmlPackage, masterPath: string, layoutPath: string): void {
  const roots = parseXml(getPartText(pkg, masterPath) ?? '')
  const root = roots.find((node) => tagName(node) === 'p:sldMaster')
  if (root === undefined) return

  const relationships = parseRelationships(getPartText(pkg, relsPartFor(masterPath)) ?? '')
  const relationship = addRelationship(
    relationships,
    SLIDE_LAYOUT_RELATIONSHIP,
    relativeTo(masterPath, layoutPath),
  )
  setPartText(pkg, relsPartFor(masterPath), serializeRelationships(relationships))

  const list = findChild(root, 'p:sldLayoutIdLst') ?? element('p:sldLayoutIdLst')
  const used = children(list)
    .map((child) => Number(attribute(child, 'id')))
    .filter((id) => Number.isFinite(id))

  children(list).push(
    element('p:sldLayoutId', {
      id: String(Math.max(FIRST_LAYOUT_ID - 1, ...used) + 1),
      'r:id': relationship.id,
    }),
  )

  // `CT_SlideMaster` is a sequence too: the layout list sits between the shapes
  // and the transition.
  upsertChild(root, list, [
    'p:cSld',
    'p:clrMap',
    'p:sldLayoutIdLst',
    'p:transition',
    'p:timing',
    'p:hf',
    'p:txStyles',
    'p:extLst',
  ])
  setPartText(pkg, masterPath, withDeclaration(buildXml(roots)))
}

/** The layout a slide arriving from another deck is built on here. */
function adoptLayout(context: Copying, sourcePath: string): string | null {
  const matched = matchingLayout(context, sourcePath)
  if (matched !== null) return matched

  const master = readPresentation(context.into).masters[0]
  if (master === undefined) return null

  const already = context.done.get(sourcePath)
  if (already !== undefined) return already

  const target = freePath(context.into, sourcePath)
  context.done.set(sourcePath, target)
  place(context, sourcePath, target)

  // Its master is this deck's, so the theme resolving its colours is this
  // deck's — the layout brings its placeholders, not its palette.
  copyRelationships(context, sourcePath, target, (relationship, resolved) =>
    relationship.type === SLIDE_MASTER_RELATIONSHIP ? master.path : copyPart(context, resolved),
  )
  registerLayout(context.into, master.path, target)
  return target
}

/**
 * The notes master for a notes page arriving here.
 *
 * This deck's where it has one. A deck where nobody has written a note has
 * none, and then theirs comes across and is registered — a notes page without
 * a master is a part PowerPoint refuses, and dropping the note instead would
 * lose what the reviewer wrote.
 */
function adoptNotesMaster(context: Copying, sourcePath: string): string | null {
  const here = readPresentation(context.into).notesMaster
  if (here !== null) return here

  const target = copyPart(context, sourcePath)
  if (target === null) return null

  const found = presentationRoot(context.into)
  if (found === null) return target

  const relationships = parseRelationships(getPartText(context.into, PRESENTATION_RELS_PART) ?? '')
  const relationship = addRelationship(
    relationships,
    NOTES_MASTER_RELATIONSHIP,
    relativeTo(PRESENTATION_PART, target),
  )
  setPartText(context.into, PRESENTATION_RELS_PART, serializeRelationships(relationships))

  const list = element('p:notesMasterIdLst', {}, [
    element('p:notesMasterId', { 'r:id': relationship.id }),
  ])
  upsertChild(found.root, list, PRESENTATION_ORDER)
  writePresentation(context.into, found.roots)

  return target
}

/** The notes page of an arriving slide, pointed back at where the slide landed. */
function copyNotes(context: Copying, sourcePath: string, slidePath: string): string | null {
  if (!context.from.parts.has(sourcePath)) return null

  const target = freePath(context.into, sourcePath)
  context.done.set(sourcePath, target)
  place(context, sourcePath, target)

  copyRelationships(context, sourcePath, target, (relationship, resolved) => {
    if (relationship.type === SLIDE_RELATIONSHIP) return slidePath
    if (relationship.type === NOTES_MASTER_RELATIONSHIP) return adoptNotesMaster(context, resolved)
    return copyPart(context, resolved)
  })

  return target
}

/** The slide of this deck that is the same slide as one of theirs, if any. */
function sameSlide(into: OoxmlPackage, from: OoxmlPackage, path: string): string | null {
  const theirs = readPresentation(from).slides.find((slide) => slide.path === path)
  if (theirs === undefined) return null

  const mine = readPresentation(into).slides.find((slide) => slide.id === theirs.id)
  return mine?.path ?? null
}

/**
 * Empties the references to relationships that did not come across.
 *
 * `r:id=""` is a real thing in the format — PowerPoint writes it for a click
 * action with no target — whereas an `r:id` naming a relationship that is not
 * in the rels part is a file it offers to repair.
 */
function blankReferences(pkg: OoxmlPackage, path: string, dropped: readonly string[]): void {
  if (dropped.length === 0) return

  const roots = parseXml(getPartText(pkg, path) ?? '')
  const gone = new Set(dropped)

  const walk = (node: XmlNode): void => {
    const attributes = node[':@']
    if (attributes !== undefined && attributes !== null) {
      for (const [name, value] of Object.entries(attributes as Record<string, unknown>)) {
        if (typeof value === 'string' && gone.has(value)) {
          setAttribute(node, name.replace(/^@_/u, ''), '')
        }
      }
    }
    for (const child of children(node)) walk(child)
  }

  for (const root of roots) walk(root)
  setPartText(pkg, path, withDeclaration(buildXml(roots)))
}

/**
 * Brings a slide of one deck into another, at a place in the order.
 *
 * Returns null when the destination has no `p:sldIdLst` to put it in or the
 * source names a slide that is not there — a deck we could not have opened.
 */
export function importSlide(
  into: OoxmlPackage,
  from: OoxmlPackage,
  sourcePath: string,
  at: number,
): AddedSlide | null {
  const text = getPartText(from, sourcePath)
  const found = presentationRoot(into)
  const list = found === null ? undefined : findChild(found.root, 'p:sldIdLst')
  if (text === undefined || found === null || list === undefined) return null

  const context: Copying = { into, from, done: new Map() }

  const name = nextSlideName(into)
  const path = `ppt/slides/${name}`
  setPartText(into, path, text)
  ensureOverride(into, path, SLIDE_CONTENT_TYPE)
  context.done.set(sourcePath, path)

  const dropped = copyRelationships(context, sourcePath, path, (relationship, resolved) => {
    switch (relationship.type) {
      case SLIDE_LAYOUT_RELATIONSHIP:
        return adoptLayout(context, resolved)
      case NOTES_SLIDE_RELATIONSHIP:
        return copyNotes(context, resolved, path)
      case SLIDE_RELATIONSHIP:
        return sameSlide(into, from, resolved)
      default:
        return copyPart(context, resolved)
    }
  })
  blankReferences(into, path, dropped)

  const relationships = parseRelationships(getPartText(into, PRESENTATION_RELS_PART) ?? '')
  const relationship = addRelationship(relationships, SLIDE_RELATIONSHIP, `slides/${name}`)
  setPartText(into, PRESENTATION_RELS_PART, serializeRelationships(relationships))

  const entries = children(list)
  const index = Math.min(Math.max(at, 0), entries.length)
  entries.splice(
    index,
    0,
    element('p:sldId', { id: String(nextSlideId(list)), 'r:id': relationship.id }),
  )

  writePresentation(into, found.roots)
  syncSections(into)
  return { path, index }
}
