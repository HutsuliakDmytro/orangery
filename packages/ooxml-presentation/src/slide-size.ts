import {
  attribute,
  buildXml,
  children,
  element,
  findChild,
  getPartText,
  parseXml,
  removeAttribute,
  setAttribute,
  setPartText,
  tagName,
  upsertChild,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'
import type { Deck, SlidePart } from './deck'
import { PRESENTATION_ORDER, PRESENTATION_PART } from './parts'
import type { SlideSize } from './presentation'
import { writePart } from './save'
import { writeTransform } from './write-shape'

/**
 * Changing how large a slide is.
 *
 * `p:sldSz` is the only place the deck states it, and every coordinate on every
 * slide is in EMU against that rectangle rather than a fraction of it. So
 * changing the size leaves the content exactly where it was in absolute terms —
 * which on a narrower slide means off the edge of it.
 *
 * PowerPoint asks which of two things was meant, and so does this: keep the
 * content at its size and let it run off, or scale it to fit. Fitting scales by
 * the smaller of the two ratios and centres the result, because scaling the
 * axes separately would turn every circle into an ellipse; the letterbox that
 * leaves on the other axis is the honest cost of changing the shape of a slide.
 */

/** How content is dealt with when the slide changes shape. */
export type ContentFit = 'maximize' | 'fit'

/** `p:presentation` in schema order, enough of it to place `p:sldSz`. */
/** The presets PowerPoint names, so the label on the size is not left stale. */
const PRESETS: { type: string; width: number; height: number }[] = [
  { type: 'screen4x3', width: 9144000, height: 6858000 },
  { type: 'screen16x9', width: 12192000, height: 6858000 },
  { type: 'screen16x10', width: 10972800, height: 6858000 },
  { type: 'letter', width: 9906000, height: 6858000 },
  { type: 'A4', width: 10287000, height: 7239000 },
]

/** Sizes a deck can be set to from a menu, largest use first. */
export const SLIDE_SIZE_PRESETS = [
  { label: 'Widescreen (16:9)', width: 12192000, height: 6858000 },
  { label: 'Standard (4:3)', width: 9144000, height: 6858000 },
  { label: 'Widescreen (16:10)', width: 10972800, height: 6858000 },
] as const

const RUN_PROPERTIES = new Set(['a:rPr', 'a:defRPr', 'a:endParaRPr'])

/**
 * Scales every font size in a part.
 *
 * Text does not scale with the box around it — a shape half the size holds the
 * same 18pt words — so the sizes have to be scaled themselves, everywhere they
 * are stated: the runs, the paragraph defaults, and the list styles a master
 * carries for every placeholder that follows it.
 */
function scaleText(node: XmlNode, factor: number): void {
  const tag = tagName(node)
  if (tag === null) return

  if (RUN_PROPERTIES.has(tag)) {
    const size = Number(attribute(node, 'sz'))
    // Hundredths of a point, and PowerPoint will not open a deck with 0.
    if (Number.isFinite(size) && size > 0) {
      setAttribute(node, 'sz', String(Math.max(Math.round(size * factor), 100)))
    }
  }

  for (const child of children(node)) scaleText(child, factor)
}

/** Scales the shapes of one part about the middle of the slide. */
function scalePart(part: SlidePart, factor: number, offset: { x: number; y: number }): void {
  // Only the shapes at the top: a group states the rectangle its children are
  // mapped into, so scaling the group scales everything inside it once.
  for (const shape of part.shapes) {
    if (shape.transform === null) continue

    writeTransform(shape, {
      ...shape.transform,
      x: shape.transform.x * factor + offset.x,
      y: shape.transform.y * factor + offset.y,
      width: shape.transform.width * factor,
      height: shape.transform.height * factor,
    })
  }

  scaleText(part.root, factor)
}

/**
 * Sets the size of every slide in the deck.
 *
 * Returns false when the deck is already that size, which is not a failure —
 * there is simply nothing to record.
 */
export function setSlideSize(
  pkg: OoxmlPackage,
  deck: Deck,
  size: SlideSize,
  content: ContentFit,
): boolean {
  const width = Math.round(size.width)
  const height = Math.round(size.height)
  if (width <= 0 || height <= 0) return false

  const before = deck.slideSize
  if (before.width === width && before.height === height) return false

  const roots = parseXml(getPartText(pkg, PRESENTATION_PART) ?? '')
  const root = roots.find((node) => tagName(node) === 'p:presentation')
  if (root === undefined) return false

  const preset = PRESETS.find((one) => one.width === width && one.height === height)
  const stated = findChild(root, 'p:sldSz') ?? element('p:sldSz')

  setAttribute(stated, 'cx', String(width))
  setAttribute(stated, 'cy', String(height))
  if (preset === undefined) removeAttribute(stated, 'type')
  else setAttribute(stated, 'type', preset.type)

  upsertChild(root, stated, PRESENTATION_ORDER)
  setPartText(pkg, PRESENTATION_PART, withDeclaration(buildXml(roots)))

  if (content === 'maximize') return true

  const factor = Math.min(width / before.width, height / before.height)
  const offset = {
    x: (width - before.width * factor) / 2,
    y: (height - before.height * factor) / 2,
  }

  // Layouts and masters as well: a placeholder's position lives there, and a
  // slide that scaled while its layout did not would tear away from it.
  for (const part of [...deck.slides, ...deck.layouts.values(), ...deck.masters.values()]) {
    scalePart(part, factor, offset)
    writePart(pkg, part.path, part.root)
  }

  return true
}
