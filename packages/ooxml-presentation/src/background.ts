import { attribute, children, findChild, tagName } from '@orangery/ooxml-core'
import { fillForReference, readColorChild, readFill } from '@orangery/ooxml-drawingml'
import type { Color, Fill, Theme } from '@orangery/ooxml-drawingml'
import { layoutOf, masterOf } from './deck'
import type { Deck, Slide, SlidePart } from './deck'

/**
 * What a slide is drawn on.
 *
 * `p:bg` states it one of two ways: a fill written out (`p:bgPr`), or a
 * reference into the theme's background fill list (`p:bgRef`) with the colour
 * to use for `phClr`. The second is what a default deck does, and its index
 * starts at 1001 rather than 1 — the background list is addressed separately
 * from the shape fills in the same scheme.
 *
 * Like everything else on a slide, it falls back: the slide's own, then the
 * layout's, then the master's. Most slides state nothing and inherit the
 * master's, which is why a renderer that only reads the slide paints
 * everything white.
 */

export interface Background {
  fill: Fill | null
  /** What `phClr` stands for while resolving colours in that fill. */
  placeholderColor: Color | null
  /** Which part stated it, for anyone tracing where a colour came from. */
  from: string | null
}

const NONE: Background = { fill: null, placeholderColor: null, from: null }

/** Reads `p:bg` from a slide, layout or master. Null when the part states none. */
export function readBackground(part: SlidePart, theme: Theme | undefined): Background | null {
  const common = findChild(part.root, 'p:cSld')
  const background = common === undefined ? undefined : findChild(common, 'p:bg')
  if (background === undefined) return null

  const properties = findChild(background, 'p:bgPr')
  if (properties !== undefined) {
    const element = children(properties).find((child) =>
      /^a:(no|solid|grad|patt|blip|grp)Fill$/u.test(tagName(child) ?? ''),
    )
    return {
      fill: element === undefined ? null : readFill(element),
      placeholderColor: null,
      from: part.path,
    }
  }

  const reference = findChild(background, 'p:bgRef')
  if (reference === undefined) return null

  const index = Number(attribute(reference, 'idx'))

  return {
    fill:
      theme === undefined || !Number.isFinite(index)
        ? null
        : fillForReference(theme.format, { index, color: null }),
    placeholderColor: readColorChild(reference),
    from: part.path,
  }
}

/** The background a slide actually shows: its own, else the layout's, else the master's. */
export function backgroundOf(deck: Deck, slide: Slide, theme: Theme | undefined): Background {
  const layout = layoutOf(deck, slide)
  const master = layout === null ? null : masterOf(deck, layout)

  for (const part of [slide, layout, master]) {
    if (part === null) continue
    const background = readBackground(part, theme)
    if (background !== null && background.fill !== null) return background
  }

  return NONE
}
