import {
  attribute,
  buildXml,
  children,
  element,
  ensureChild,
  getPartText,
  parseXml,
  removeChild,
  setPartText,
  tagName,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'

/**
 * The guides a person drags out of the rulers.
 *
 * They belong to the window rather than to the deck — nothing on a slide lines
 * up with them once the file is closed — and PowerPoint keeps them in
 * `viewProps.xml` accordingly, beside the zoom and the scroll position.
 *
 * `p:guide/@pos` is in eighths of a point, which is the one unit in the whole
 * format that is neither EMU nor a percentage. Everything here speaks EMU and
 * converts at the edge.
 */

const VIEW_PROPERTIES_PART = 'ppt/viewProps.xml'

/** An eighth of a point, in EMU. */
const UNIT = 12700 / 8

/** `p:viewPr` in schema order. */
const VIEW_PROPERTIES = [
  'p:normalViewPr',
  'p:slideViewPr',
  'p:outlineViewPr',
  'p:notesTextViewPr',
  'p:sorterViewPr',
  'p:notesViewPr',
  'p:gridSpacing',
  'p:extLst',
]

export interface SlideGuide {
  /** `horz` runs across the slide, so what it states is a height. */
  orientation: 'horz' | 'vert'
  /** Where it sits, in EMU. */
  at: number
}

function viewRoot(pkg: OoxmlPackage): { roots: XmlNode[]; root: XmlNode } | null {
  const text = getPartText(pkg, VIEW_PROPERTIES_PART)
  if (text === undefined) return null

  const roots = parseXml(text)
  const root = roots.find((node) => tagName(node) === 'p:viewPr')
  return root === undefined ? null : { roots, root }
}

function guideListOf(root: XmlNode, make: boolean): XmlNode | undefined {
  const slideView = make
    ? ensureChild(root, 'p:slideViewPr', VIEW_PROPERTIES)
    : children(root).find((child) => tagName(child) === 'p:slideViewPr')
  if (slideView === undefined) return undefined

  const common = make
    ? ensureChild(slideView, 'p:cSldViewPr', ['p:cSldViewPr'])
    : children(slideView).find((child) => tagName(child) === 'p:cSldViewPr')
  if (common === undefined) return undefined

  if (!make) return children(common).find((child) => tagName(child) === 'p:guideLst')

  // `p:cViewPr` comes first and must carry both a scale and an origin; a
  // `p:cSldViewPr` missing them is a file PowerPoint offers to repair.
  if (children(common).every((child) => tagName(child) !== 'p:cViewPr')) {
    children(common).unshift(
      element('p:cViewPr', { varScale: '1' }, [
        element('p:scale', {}, [
          element('a:sx', { n: '100', d: '100' }),
          element('a:sy', { n: '100', d: '100' }),
        ]),
        element('p:origin', { x: '0', y: '0' }),
      ]),
    )
  }

  return ensureChild(common, 'p:guideLst', ['p:cViewPr', 'p:guideLst'])
}

/** The guides a deck was last left with, in the order the file lists them. */
export function readGuides(pkg: OoxmlPackage): SlideGuide[] {
  const found = viewRoot(pkg)
  const list = found === null ? undefined : guideListOf(found.root, false)
  if (list === undefined) return []

  return children(list).flatMap((guide) => {
    if (tagName(guide) !== 'p:guide') return []

    const position = Number(attribute(guide, 'pos'))
    if (!Number.isFinite(position)) return []

    // Vertical is the default, which is why most guides state no orientation.
    return [
      {
        orientation: attribute(guide, 'orient') === 'horz' ? ('horz' as const) : ('vert' as const),
        at: position * UNIT,
      },
    ]
  })
}

/**
 * Replaces the guides of a deck.
 *
 * An empty list removes the element rather than writing an empty one, which is
 * what PowerPoint does and what keeps a deck that never had guides from
 * growing a `p:guideLst` because somebody opened the rulers.
 */
export function writeGuides(pkg: OoxmlPackage, guides: readonly SlideGuide[]): boolean {
  const found = viewRoot(pkg)
  if (found === null) return false

  if (guides.length === 0) {
    const list = guideListOf(found.root, false)
    if (list === undefined) return false

    const slideView = children(found.root).find((child) => tagName(child) === 'p:slideViewPr')
    const common =
      slideView === undefined
        ? undefined
        : children(slideView).find((child) => tagName(child) === 'p:cSldViewPr')
    if (common === undefined) return false

    removeChild(common, 'p:guideLst')
    setPartText(pkg, VIEW_PROPERTIES_PART, withDeclaration(buildXml(found.roots)))
    return true
  }

  const list = guideListOf(found.root, true)
  if (list === undefined) return false

  const written = guides.map((guide) =>
    element('p:guide', {
      ...(guide.orientation === 'horz' ? { orient: 'horz' } : {}),
      pos: String(Math.max(Math.round(guide.at / UNIT), 0)),
    }),
  )

  children(list).splice(0, children(list).length, ...written)
  setPartText(pkg, VIEW_PROPERTIES_PART, withDeclaration(buildXml(found.roots)))
  return true
}

/** Adds one, keeping the list in the order a person reads it. */
export function addGuide(pkg: OoxmlPackage, guide: SlideGuide): boolean {
  const guides = [...readGuides(pkg), guide].sort(
    (one, two) => one.orientation.localeCompare(two.orientation) || one.at - two.at,
  )
  return writeGuides(pkg, guides)
}

/** Moves the guide at `index` in the list `readGuides` returns. */
export function moveGuide(pkg: OoxmlPackage, index: number, at: number): boolean {
  const guides = readGuides(pkg)
  const guide = guides[index]
  if (guide === undefined || guide.at === at) return false

  return writeGuides(
    pkg,
    guides.map((one, at_) => (at_ === index ? { ...one, at } : one)),
  )
}

export function removeGuide(pkg: OoxmlPackage, index: number): boolean {
  const guides = readGuides(pkg)
  if (guides[index] === undefined) return false

  return writeGuides(
    pkg,
    guides.filter((_, at) => at !== index),
  )
}
