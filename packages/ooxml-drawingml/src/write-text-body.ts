import {
  attribute,
  element,
  ensureChild,
  findChild,
  removeAttribute,
  removeChild,
  setAttribute,
  upsertChild,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * Changing how a text box holds its text.
 *
 * `a:bodyPr` is the box, not the words: where the text sits in it, how much
 * space is left around the edge, whether a long line wraps or runs past, and
 * what gives when there is more text than room.
 *
 * Absent is not the same as stated here either. A shape with no `anchor` takes
 * the one its placeholder gives it, so clearing the anchor removes the
 * attribute rather than writing `t` — the two look alike on this slide and stop
 * looking alike the moment the layout changes.
 */

/** `a:bodyPr` in schema order. */
const BODY_PROPERTIES = [
  'a:prstTxWarp',
  'a:noAutofit',
  'a:normAutofit',
  'a:spAutoFit',
  'a:scene3d',
  'a:sp3d',
  'a:flatTx',
  'a:extLst',
]

const AUTOFIT_TAGS = ['a:noAutofit', 'a:normAutofit', 'a:spAutoFit']

/** Where the text sits vertically: top, middle, bottom. */
export type Anchor = 't' | 'ctr' | 'b'

/** `square` wraps at the box edge; `none` lets a line run past it. */
export type Wrap = 'square' | 'none'

/**
 * What gives when there is more text than room.
 *
 * `none` lets it overflow, `shrink` scales the text down, `shape` grows the box
 * to fit. These are three elements in the file rather than one attribute, and
 * exactly one of them may be present.
 */
export type AutofitKind = 'none' | 'shrink' | 'shape'

export interface BodyChange {
  anchor?: Anchor | null
  wrap?: Wrap | null
  autofit?: AutofitKind | null
  /** Padding in EMU; null clears one and leaves the default in its place. */
  insets?: Partial<Record<'left' | 'top' | 'right' | 'bottom', number | null>>
  /** Columns across the box, or null for the single column that is the default. */
  columns?: { count: number; spacing?: number | null } | null
}

const INSET_ATTRIBUTES = { left: 'lIns', top: 'tIns', right: 'rIns', bottom: 'bIns' } as const

/** The `a:bodyPr` of a text body, made if it has none. */
export function bodyPropertiesOf(body: XmlNode): XmlNode {
  // First child of a text body, before the list style and the paragraphs.
  return ensureChild(body, 'a:bodyPr', ['a:bodyPr', 'a:lstStyle', 'a:p'])
}

/**
 * Applies what is named and leaves the rest.
 *
 * Only what is named changes: setting the anchor leaves the insets alone, which
 * is how a properties panel is expected to behave and what keeps two controls
 * from undoing each other.
 */
export function writeBodyProperties(body: XmlNode, change: BodyChange): boolean {
  const properties = bodyPropertiesOf(body)
  let changed = false

  if (change.anchor !== undefined) {
    if (change.anchor === null) removeAttribute(properties, 'anchor')
    else setAttribute(properties, 'anchor', change.anchor)
    changed = true
  }

  if (change.wrap !== undefined) {
    if (change.wrap === null) removeAttribute(properties, 'wrap')
    else setAttribute(properties, 'wrap', change.wrap)
    changed = true
  }

  if (change.insets !== undefined) {
    for (const [side, attribute] of Object.entries(INSET_ATTRIBUTES)) {
      const value = change.insets[side as keyof typeof INSET_ATTRIBUTES]
      if (value === undefined) continue

      if (value === null) removeAttribute(properties, attribute)
      else setAttribute(properties, attribute, String(Math.round(Math.max(value, 0))))
      changed = true
    }
  }

  if (change.columns !== undefined) {
    if (change.columns === null) {
      removeAttribute(properties, 'numCol')
      removeAttribute(properties, 'spcCol')
    } else {
      setAttribute(properties, 'numCol', String(Math.max(Math.round(change.columns.count), 1)))
      const spacing = change.columns.spacing
      if (spacing === null) removeAttribute(properties, 'spcCol')
      else if (spacing !== undefined) {
        setAttribute(properties, 'spcCol', String(Math.round(Math.max(spacing, 0))))
      }
    }
    changed = true
  }

  if (change.autofit !== undefined) {
    // Exactly one of the three, so the others go before the new one arrives.
    for (const tag of AUTOFIT_TAGS) removeChild(properties, tag)

    if (change.autofit === 'none') {
      upsertChild(properties, element('a:noAutofit'), BODY_PROPERTIES)
    }
    if (change.autofit === 'shape') {
      upsertChild(properties, element('a:spAutoFit'), BODY_PROPERTIES)
    }
    if (change.autofit === 'shrink') {
      // No `fontScale` of our own: PowerPoint records what it has already shrunk
      // the text to and reads its own number back, and a guess here would
      // resize text on open. Asking for shrinking is not claiming to know by
      // how much.
      upsertChild(properties, element('a:normAutofit'), BODY_PROPERTIES)
    }
    changed = true
  }

  return changed
}

/** What a body states today, for a panel that has to show something. */
export function autofitKindOf(body: XmlNode): AutofitKind | null {
  const properties = findChild(body, 'a:bodyPr')
  if (properties === undefined) return null

  if (findChild(properties, 'a:noAutofit') !== undefined) return 'none'
  if (findChild(properties, 'a:spAutoFit') !== undefined) return 'shape'
  return findChild(properties, 'a:normAutofit') === undefined ? null : 'shrink'
}

/**
 * Records what the text has been shrunk to.
 *
 * Only on a body that already asks to be shrunk: writing a scale into a shape
 * that never asked would shrink its text in PowerPoint on open, which is a
 * change to the document made by having looked at it.
 *
 * The scale is thousandths of a percent, like every other ratio in DrawingML.
 * A hundred percent is written as no attribute at all, because that is what an
 * unshrunk shape says and a deck full of `fontScale="100000"` is a deck that
 * differs from its file for no reason.
 *
 * `lnSpcReduction` is the other lever, and it is left where the file put it:
 * how PowerPoint pairs the two is not written down anywhere, and the text was
 * measured with the reduction already in effect, so the scale answered here
 * fits with it. Where a stated scale goes back to full size the reduction goes
 * with it: they were written together by whatever shrank the text, and keeping
 * one would leave the lines squashed under words that now overflow nothing. A
 * body that states only a reduction is left alone — PowerPoint reduces spacing
 * before it touches the font size, so that one is a decision rather than a
 * leftover.
 */
export function writeAutofitScale(body: XmlNode, fontScale: number): boolean {
  const properties = findChild(body, 'a:bodyPr')
  const normal = properties === undefined ? undefined : findChild(properties, 'a:normAutofit')
  if (normal === undefined) return false

  const wanted = Math.round(Math.min(Math.max(fontScale, 1000), 100000))
  const written = wanted >= 100000 ? null : String(wanted)
  if ((attribute(normal, 'fontScale') ?? null) === written) return false

  if (written === null) {
    removeAttribute(normal, 'fontScale')
    removeAttribute(normal, 'lnSpcReduction')
  } else setAttribute(normal, 'fontScale', written)

  return true
}
