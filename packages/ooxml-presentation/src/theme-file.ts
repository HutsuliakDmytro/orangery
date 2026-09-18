import {
  buildXml,
  element,
  getPartText,
  parseRelationships,
  resolveTarget,
  partDirectory,
  serializeRelationships,
  setPartText,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, Relationship } from '@orangery/ooxml-core'
import type { Deck, Master } from './deck'
import { SLIDE_MASTER_RELATIONSHIP, THEME_RELATIONSHIP } from './parts'

/**
 * A deck's own look, as a theme file other programs can open.
 *
 * `.thmx` is an OOXML package like a deck is, holding the theme, the master it
 * belongs to and that master's layouts. Nothing here is regenerated: the parts
 * are copied across as they are and only the relationships between them are
 * rewritten, because what changed is where they live, not what they say. A
 * theme rebuilt from a reading of itself would be a theme missing whatever the
 * reading does not model.
 *
 * The master is the reason a theme is more than a palette. Where the title
 * sits, what a bullet looks like, what the background is — none of that is in
 * `a:theme`, and a file carrying only the colours would produce decks that
 * share a palette and look nothing alike.
 */

const THEME_MANAGER_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/themeManager'

const TYPES = {
  themeManager: 'application/vnd.openxmlformats-officedocument.themeManager+xml',
  theme: 'application/vnd.openxmlformats-officedocument.theme+xml',
  master: 'application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml',
  layout: 'application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml',
}

const MANAGER_PART = 'theme/themeManager.xml'
const THEME_PART = 'theme/theme1.xml'
const MASTER_PART = 'theme/slideMasters/slideMaster1.xml'

const relsFor = (path: string) => {
  const directory = partDirectory(path)
  return `${directory}/_rels/${path.slice(directory.length + 1)}.rels`
}

/** A part's relationships, with targets resolved to package paths. */
function relationshipsOf(pkg: OoxmlPackage, path: string): Map<string, Relationship> {
  const text = getPartText(pkg, relsFor(path))
  if (text === undefined) return new Map()

  const directory = partDirectory(path)
  return new Map(
    [...parseRelationships(text)].map(([id, relationship]) => [
      id,
      {
        ...relationship,
        target: relationship.external
          ? relationship.target
          : resolveTarget(relationship.target, directory),
      },
    ]),
  )
}

/** Copies a part across untouched, whatever it holds. */
function copyPart(from: OoxmlPackage, to: OoxmlPackage, source: string, target: string): boolean {
  const part = from.parts.get(source)
  if (part === undefined) return false

  to.parts.set(target, { ...part, path: target })
  return true
}

interface Placed {
  /** Where the part came from and where it went. */
  source: string
  target: string
}

/**
 * Where each relationship should now point, or null to drop it.
 *
 * Ids are kept exactly as they were. The master names its layouts by `r:id` in
 * `p:sldLayoutIdLst`, so keeping the ids is what lets every part be copied
 * without being edited — only the file each id resolves to changes.
 */
function retarget(
  relationship: Relationship,
  from: string,
  placed: readonly Placed[],
): string | null {
  if (relationship.external) return null

  const landed = placed.find((one) => one.source === relationship.target)
  if (landed === undefined) return null

  return relativeTo(from, landed.target)
}

/** A package path as a relationship target, relative to the part naming it. */
function relativeTo(fromPath: string, toPath: string): string {
  const from = partDirectory(fromPath).split('/').filter(Boolean)
  const to = toPath.split('/').filter(Boolean)

  let shared = 0
  while (shared < from.length && shared < to.length && from[shared] === to[shared]) shared += 1

  return [...Array.from({ length: from.length - shared }, () => '..'), ...to.slice(shared)].join(
    '/',
  )
}

function writeRelationships(
  pkg: OoxmlPackage,
  path: string,
  entries: readonly { id: string; type: string; target: string }[],
): void {
  setPartText(
    pkg,
    relsFor(path),
    serializeRelationships(
      new Map(entries.map((entry) => [entry.id, { ...entry, external: false }])),
    ),
  )
}

/** `[Content_Types].xml` for the parts actually written. */
function contentTypes(pkg: OoxmlPackage, overrides: readonly { path: string; type: string }[]) {
  const extensions = new Set(
    [...pkg.parts.keys()].flatMap((path) => {
      const extension = path.split('.').pop()?.toLowerCase()
      return extension === undefined || extension === path.toLowerCase() ? [] : [extension]
    }),
  )

  const defaults = [...extensions].sort().flatMap((extension) => {
    const type = DEFAULT_TYPES[extension]
    return type === undefined
      ? []
      : [element('Default', { Extension: extension, ContentType: type })]
  })

  return withDeclaration(
    buildXml([
      element('Types', { xmlns: 'http://schemas.openxmlformats.org/package/2006/content-types' }, [
        ...defaults,
        ...overrides.map((override) =>
          element('Override', { PartName: `/${override.path}`, ContentType: override.type }),
        ),
      ]),
    ]),
  )
}

/** What a file extension means, for the parts a theme can carry. */
const DEFAULT_TYPES: Readonly<Record<string, string>> = {
  rels: 'application/vnd.openxmlformats-package.relationships+xml',
  xml: 'application/xml',
  png: 'image/png',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  emf: 'image/x-emf',
  wmf: 'image/x-wmf',
  svg: 'image/svg+xml',
}

/**
 * Builds the `.thmx` package for one of the deck's masters.
 *
 * Null when that master has no theme: a theme file with no theme in it is not a
 * smaller theme, it is a file that means nothing.
 */
export function buildThemeFile(pkg: OoxmlPackage, deck: Deck, master: Master): OoxmlPackage | null {
  if (master.theme === null) return null

  const out: OoxmlPackage = { parts: new Map() }
  if (!copyPart(pkg, out, master.theme, THEME_PART)) return null
  copyPart(pkg, out, master.path, MASTER_PART)

  const placed: Placed[] = [
    { source: master.theme, target: THEME_PART },
    { source: master.path, target: MASTER_PART },
  ]

  const layouts = master.layouts.filter((path) => deck.layouts.has(path))
  layouts.forEach((path, index) => {
    const target = `theme/slideLayouts/slideLayout${String(index + 1)}.xml`
    if (copyPart(pkg, out, path, target)) placed.push({ source: path, target })
  })

  // Whatever the master and its layouts point at that is not one of them: the
  // background picture, a logo in the corner. A theme without them is a theme
  // that looks different from the deck it was taken from.
  let media = 0
  for (const path of [master.path, ...layouts]) {
    for (const relationship of relationshipsOf(pkg, path).values()) {
      if (relationship.external) continue
      if (placed.some((one) => one.source === relationship.target)) continue
      if (!pkg.parts.has(relationship.target)) continue

      media += 1
      const extension = relationship.target.split('.').pop() ?? 'png'
      const target = `theme/media/image${String(media)}.${extension}`
      if (copyPart(pkg, out, relationship.target, target)) {
        placed.push({ source: relationship.target, target })
      }
    }
  }

  // The manager is the root of a theme file, the way `presentation.xml` is the
  // root of a deck: an empty element whose whole job is to be pointed at and to
  // point at the theme and the master.
  setPartText(
    out,
    MANAGER_PART,
    withDeclaration(
      buildXml([
        element('p:themeManager', {
          'xmlns:a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
          'xmlns:p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
        }),
      ]),
    ),
  )

  writeRelationships(out, MANAGER_PART, [
    { id: 'rId1', type: THEME_RELATIONSHIP, target: relativeTo(MANAGER_PART, THEME_PART) },
    { id: 'rId2', type: SLIDE_MASTER_RELATIONSHIP, target: relativeTo(MANAGER_PART, MASTER_PART) },
  ])

  for (const { source, target } of placed) {
    if (!source.endsWith('.xml')) continue

    const kept = [...relationshipsOf(pkg, source)].flatMap(([id, relationship]) => {
      const retargeted = retarget(relationship, target, placed)
      // A relationship whose other end did not come along is dropped, not left
      // dangling: an id naming nothing is the file PowerPoint offers to repair.
      return retargeted === null ? [] : [{ id, type: relationship.type, target: retargeted }]
    })
    if (kept.length > 0) writeRelationships(out, target, kept)
  }

  setPartText(
    out,
    '_rels/.rels',
    serializeRelationships(
      new Map([
        [
          'rId1',
          {
            id: 'rId1',
            type: THEME_MANAGER_RELATIONSHIP,
            target: MANAGER_PART,
            external: false,
          },
        ],
      ]),
    ),
  )

  setPartText(
    out,
    '[Content_Types].xml',
    contentTypes(out, [
      { path: MANAGER_PART, type: TYPES.themeManager },
      { path: THEME_PART, type: TYPES.theme },
      { path: MASTER_PART, type: TYPES.master },
      ...placed
        .filter((one) => one.target.startsWith('theme/slideLayouts/'))
        .map((one) => ({ path: one.target, type: TYPES.layout })),
    ]),
  )

  return out
}
