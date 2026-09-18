import { attributes, findChild, getPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { parseTheme } from '@orangery/ooxml-drawingml'
import type { ColorContext, Theme } from '@orangery/ooxml-drawingml'
import { layoutOf, masterOf } from './deck'
import type { Deck, Master, Slide } from './deck'

/**
 * What a colour on a slide means.
 *
 * Two parts have to meet for that question to have an answer. The theme names
 * the palette — `accent1`, `dk1` — and the master carries a `p:clrMap` saying
 * which of those a shape means by `tx1` or `bg1`. Shapes and themes use two
 * different vocabularies, and the map is the only thing joining them.
 *
 * Inverting the map, rather than reading it forwards, is the part worth getting
 * right: it is written `tx1="dk1"`, and a shape asking for `tx1` needs `dk1`.
 */

/** `p:clrMap` as a shape reads it: the name in the shape to the slot in the theme. */
export function readColorMap(master: Master): Map<string, string> {
  const common = findChild(master.root, 'p:clrMap')
  if (common === undefined) return new Map()

  return new Map(Object.entries(attributes(common)))
}

/** Themes by part path, parsed once per deck. */
export function readThemes(pkg: OoxmlPackage, deck: Deck): Map<string, Theme> {
  const themes = new Map<string, Theme>()

  for (const master of deck.masters.values()) {
    if (master.theme === null || themes.has(master.theme)) continue
    const text = getPartText(pkg, master.theme)
    if (text !== undefined) themes.set(master.theme, parseTheme(text))
  }

  return themes
}

/** The theme a slide draws from, through its layout and its master. */
export function themeFor(
  deck: Deck,
  themes: ReadonlyMap<string, Theme>,
  slide: Slide,
): Theme | undefined {
  const layout = layoutOf(deck, slide)
  const master = layout === null ? null : masterOf(deck, layout)
  return master?.theme == null ? undefined : themes.get(master.theme)
}

/**
 * The context for resolving colours on a slide.
 *
 * Empty rather than throwing when the deck does not reach a theme: a slide with
 * no resolvable palette should draw in whatever the shapes state literally, not
 * fail to draw.
 */
export function colorContextFor(
  deck: Deck,
  themes: ReadonlyMap<string, Theme>,
  slide: Slide,
): ColorContext {
  const layout = layoutOf(deck, slide)
  const master = layout === null ? null : masterOf(deck, layout)
  if (master === null) return { scheme: new Map(), map: new Map() }

  const theme = master.theme === null ? undefined : themes.get(master.theme)

  return {
    scheme: theme?.colors ?? new Map(),
    map: readColorMap(master),
  }
}
