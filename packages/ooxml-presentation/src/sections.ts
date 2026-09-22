import {
  attribute,
  buildXml,
  children,
  element,
  findChild,
  getPartText,
  parseXml,
  removeChild,
  setPartText,
  tagName,
  upsertChild,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import { PRESENTATION_ORDER, presentationPart } from './parts'

/**
 * Sections: the named runs a long deck is divided into.
 *
 * They are not part of the original schema. PowerPoint 2010 added them in an
 * extension on `p:presentation`, keyed by a uri that nothing else uses, holding
 * a list of sections that each name the slides in it by slide id.
 *
 * Sections partition the slide list in order — that is what a section is, and
 * the file cannot express anything else. So a section is modelled by where it
 * begins and the rest follows, which is also why dragging a slide across a
 * boundary moves it into the other section without anything having to say so.
 *
 * The file's own lists are still what gets written, because that is what
 * PowerPoint reads; they are rebuilt from the boundaries on every change rather
 * than patched, which is the only way a slide cannot end up in two sections.
 */

const SECTION_EXT = '{521415D9-36F7-43E2-AB2F-B90AF26B5E84}'
const P14 = 'http://schemas.microsoft.com/office/powerpoint/2010/main'

export interface Section {
  /** `{GUID}` as the file states it; what a rename or a delete names. */
  id: string
  name: string
  /** Index into the deck's slides where the section begins. */
  start: number
}

function presentationRoot(pkg: OoxmlPackage): { roots: XmlNode[]; root: XmlNode } | null {
  const roots = parseXml(getPartText(pkg, presentationPart(pkg)) ?? '')
  const root = roots.find((node) => tagName(node) === 'p:presentation')
  return root === undefined ? null : { roots, root }
}

/** The slide ids in the order the deck shows them. */
function slideIds(root: XmlNode): number[] {
  const list = findChild(root, 'p:sldIdLst')
  if (list === undefined) return []

  return children(list).flatMap((entry) => {
    const id = Number(attribute(entry, 'id'))
    return tagName(entry) === 'p:sldId' && Number.isFinite(id) ? [id] : []
  })
}

function sectionListOf(root: XmlNode): XmlNode | undefined {
  const extensions = findChild(root, 'p:extLst')
  if (extensions === undefined) return undefined

  const found = children(extensions).find((ext) => attribute(ext, 'uri') === SECTION_EXT)
  return found === undefined ? undefined : findChild(found, 'p14:sectionLst')
}

/**
 * The sections of a deck, in order, each with the slide it begins at.
 *
 * The boundary is the first slide of the section that is still in the deck —
 * not simply the first one listed, because a slide that was deleted is still
 * listed in a file PowerPoint has not rewritten. A section none of whose slides
 * survive begins where the next one does, which is to say it is empty.
 */
export function readSections(pkg: OoxmlPackage): Section[] {
  const found = presentationRoot(pkg)
  const list = found === null ? undefined : sectionListOf(found.root)
  if (found === null || list === undefined) return []

  const order = slideIds(found.root)
  const position = new Map(order.map((id, index) => [id, index]))

  const read = children(list).flatMap((section) => {
    if (tagName(section) !== 'p14:section') return []

    const ids = findChild(section, 'p14:sldIdLst')
    const members =
      ids === undefined
        ? []
        : children(ids).flatMap((entry) => {
            const at = position.get(Number(attribute(entry, 'id')))
            return at === undefined ? [] : [at]
          })

    return [
      {
        id: attribute(section, 'id') ?? '',
        name: attribute(section, 'name') ?? '',
        start: members.length === 0 ? null : Math.min(...members),
      },
    ]
  })

  // An empty section begins where the next one does; the last one, at the end.
  const sections: Section[] = []
  let next = order.length
  for (let index = read.length - 1; index >= 0; index -= 1) {
    const section = read[index]
    if (section === undefined) continue

    const start = section.start ?? next
    sections.unshift({ id: section.id, name: section.name, start })
    next = start
  }

  // The first section always begins at the first slide: everything is in one.
  const first = sections[0]
  if (first !== undefined) first.start = 0
  return sections
}

/** Which section each slide falls in, by index into `sections`. */
export function sectionOfSlide(sections: readonly Section[], slide: number): number {
  let found = -1
  for (const [index, section] of sections.entries()) {
    if (section.start <= slide) found = index
  }
  return found
}

/** The slides a section holds, as indexes into the deck. */
export function slidesOfSection(
  sections: readonly Section[],
  index: number,
  total: number,
): number[] {
  const section = sections[index]
  if (section === undefined) return []

  const end = sections[index + 1]?.start ?? total
  return Array.from(
    { length: Math.max(end - section.start, 0) },
    (_, offset) => section.start + offset,
  )
}

/**
 * Writes the section list back, rebuilt from where each section begins.
 *
 * An empty list removes the extension rather than writing an empty one: a deck
 * with no sections is not a deck with nothing in its section list, and the
 * difference shows in PowerPoint's own menu.
 */
export function writeSections(pkg: OoxmlPackage, sections: readonly Section[]): boolean {
  const found = presentationRoot(pkg)
  if (found === null) return false

  const order = slideIds(found.root)

  if (sections.length === 0) {
    const extensions = findChild(found.root, 'p:extLst')
    if (extensions === undefined) return false

    const rest = children(extensions).filter((ext) => attribute(ext, 'uri') !== SECTION_EXT)
    if (rest.length === children(extensions).length) return false

    if (rest.length === 0) removeChild(found.root, 'p:extLst')
    else children(extensions).splice(0, children(extensions).length, ...rest)

    setPartText(pkg, presentationPart(pkg), withDeclaration(buildXml(found.roots)))
    return true
  }

  const nodes = sections.map((section, index) => {
    const end = sections[index + 1]?.start ?? order.length
    const members = order
      .slice(section.start, Math.max(end, section.start))
      .map((id) => element('p14:sldId', { id: String(id) }))

    return element('p14:section', { name: section.name, id: section.id }, [
      element('p14:sldIdLst', {}, members),
    ])
  })

  const list = element('p14:sectionLst', { 'xmlns:p14': P14 }, nodes)
  const ext = element('p:ext', { uri: SECTION_EXT }, [list])

  const extensions = findChild(found.root, 'p:extLst') ?? element('p:extLst')
  const siblings = children(extensions)
  const existing = siblings.findIndex((one) => attribute(one, 'uri') === SECTION_EXT)

  if (existing === -1) siblings.push(ext)
  else siblings[existing] = ext

  upsertChild(found.root, extensions, PRESENTATION_ORDER)
  setPartText(pkg, presentationPart(pkg), withDeclaration(buildXml(found.roots)))
  return true
}

/** A fresh section id in the `{GUID}` form PowerPoint writes. */
function newSectionId(): string {
  return `{${globalThis.crypto.randomUUID().toUpperCase()}}`
}

/**
 * Starts a section at a slide, splitting whatever section it was in.
 *
 * A deck with no sections at all gets two: everything before the split, under
 * the name PowerPoint uses, and the new one. There is no way to say "these
 * slides are in no section" once one exists — which is also why starting one at
 * the first slide of an unsectioned deck names the whole deck rather than
 * failing to split what has no left-hand side.
 */
export function addSection(pkg: OoxmlPackage, name: string, start: number): boolean {
  const found = presentationRoot(pkg)
  if (found === null) return false

  const total = slideIds(found.root).length
  if (start < 0 || start >= total) return false

  const existing = readSections(pkg)

  // At the first slide of a deck with no sections there is nothing to split:
  // the one section named here covers the deck, which is where PowerPoint
  // starts too.
  if (existing.length === 0 && start === 0) {
    return writeSections(pkg, [{ id: newSectionId(), name, start: 0 }])
  }
  if (start === 0) return false

  const sections =
    existing.length === 0 ? [{ id: newSectionId(), name: 'Default Section', start: 0 }] : existing

  if (sections.some((section) => section.start === start)) return false

  const added = { id: newSectionId(), name, start }
  const at = sections.findIndex((section) => section.start > start)

  return writeSections(
    pkg,
    at === -1 ? [...sections, added] : [...sections.slice(0, at), added, ...sections.slice(at)],
  )
}

export function renameSection(pkg: OoxmlPackage, id: string, name: string): boolean {
  const sections = readSections(pkg)
  if (!sections.some((section) => section.id === id && section.name !== name)) return false

  return writeSections(
    pkg,
    sections.map((section) => (section.id === id ? { ...section, name } : section)),
  )
}

/**
 * Removes a section, leaving its slides where they are.
 *
 * They join the section before it, because a slide has to be in one once the
 * deck has any. Removing the first section removes the boundary at the top,
 * which is no boundary at all — so it takes the whole list with it and the deck
 * goes back to having none.
 */
export function removeSection(pkg: OoxmlPackage, id: string): boolean {
  const sections = readSections(pkg)
  const at = sections.findIndex((section) => section.id === id)
  if (at === -1) return false

  return writeSections(pkg, at === 0 ? [] : sections.filter((_, index) => index !== at))
}

/**
 * Puts the section list back in step with a slide list that changed.
 *
 * Reading derives the boundaries from the slides still in the deck, so writing
 * what was read is exactly the repair: slides that went away drop out, and ones
 * that arrived join the section they landed in.
 */
export function syncSections(pkg: OoxmlPackage): boolean {
  const sections = readSections(pkg)
  return sections.length === 0 ? false : writeSections(pkg, sections)
}
