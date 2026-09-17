import { attribute, children, findChild, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { readFill, readLine } from './shape-properties'
import type { Fill, Line, StyleReference } from './shape-properties'

/**
 * `a:fmtScheme` — the theme's looks, which shapes refer to instead of repeating.
 *
 * A shape that states no fill of its own is not unfilled. It carries a
 * `p:style` with `<a:fillRef idx="3">` and a colour, meaning "the third fill in
 * the theme, in this colour". The theme's own fills are written in terms of
 * `phClr` — the placeholder colour — and the reference is what supplies it.
 *
 * That indirection is why a deck restyles wholesale when the theme changes, and
 * why resolving a fill at parse time would freeze it.
 */

export interface FormatScheme {
  name: string
  /** `a:fillStyleLst`: subtle, moderate, intense. Referred to by 1-based index. */
  fills: Fill[]
  lines: Line[]
  /** `a:bgFillStyleLst`, referred to by index from 1001. */
  backgroundFills: Fill[]
}

export const EMPTY_FORMAT_SCHEME: FormatScheme = {
  name: '',
  fills: [],
  lines: [],
  backgroundFills: [],
}

function fillsIn(list: XmlNode | undefined): Fill[] {
  if (list === undefined) return []

  return children(list).flatMap((child) => {
    const fill = readFill(child)
    return fill === null ? [] : [fill]
  })
}

export function readFormatScheme(element: XmlNode): FormatScheme {
  const lines = findChild(element, 'a:lnStyleLst')

  return {
    name: attribute(element, 'name') ?? '',
    fills: fillsIn(findChild(element, 'a:fillStyleLst')),
    lines: (lines === undefined ? [] : children(lines))
      .filter((child) => tagName(child) === 'a:ln')
      .map(readLine),
    backgroundFills: fillsIn(findChild(element, 'a:bgFillStyleLst')),
  }
}

/**
 * Where a reference points.
 *
 * `idx` is one-based, and zero means "no fill at all" rather than "the first
 * one" — an easy off-by-one to get backwards, and it makes shapes that should
 * be transparent opaque. Indices from 1001 address the background fill list,
 * which is how a slide background refers to the same scheme.
 */
export function fillForReference(
  scheme: FormatScheme,
  reference: StyleReference | null,
): Fill | null {
  if (reference === null || reference.index === 0) return null

  if (reference.index >= 1001) {
    return scheme.backgroundFills[reference.index - 1001] ?? null
  }
  return scheme.fills[reference.index - 1] ?? null
}

export function lineForReference(
  scheme: FormatScheme,
  reference: StyleReference | null,
): Line | null {
  if (reference === null || reference.index === 0) return null
  return scheme.lines[reference.index - 1] ?? null
}
