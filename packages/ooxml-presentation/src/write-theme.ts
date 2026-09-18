import {
  buildXml,
  children,
  element,
  findChild,
  getPartText,
  parseXml,
  setAttribute,
  setPartText,
  tagName,
  upsertChild,
  withDeclaration,
} from '@orangery/ooxml-core'
import type { OoxmlPackage, XmlNode } from '@orangery/ooxml-core'

/**
 * Changing the theme a deck is drawn from.
 *
 * Nothing on a slide is repainted. A shape that says `schemeClr accent1` is
 * already saying "whatever the theme calls accent 1", so changing the theme
 * changes what it is drawn in — that is the whole point of the indirection, and
 * it is why applying a theme is a small edit to one part rather than a pass
 * over every shape in the deck.
 *
 * Shapes that state a literal colour keep it, which is correct and is also why
 * the properties panel says so plainly when it writes one.
 */

/** `a:clrScheme` in schema order; the slots are a sequence, not a set. */
const COLOR_SLOTS = [
  'dk1',
  'lt1',
  'dk2',
  'lt2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
] as const

export type ColorSlot = (typeof COLOR_SLOTS)[number]

export interface ThemeFontChange {
  /** Headings, `a:majorFont`. */
  major?: string
  /** Body text, `a:minorFont`. */
  minor?: string
}

function themeElements(pkg: OoxmlPackage, path: string) {
  const roots = parseXml(getPartText(pkg, path) ?? '')
  const theme = roots.find((node) => tagName(node) === 'a:theme')
  const elements = theme === undefined ? undefined : findChild(theme, 'a:themeElements')

  return theme === undefined || elements === undefined ? null : { roots, theme, elements }
}

function write(pkg: OoxmlPackage, path: string, roots: XmlNode[]): void {
  setPartText(pkg, path, withDeclaration(buildXml(roots)))
}

/**
 * Sets the two fonts a theme names.
 *
 * Only the latin face is written. A theme also names an east-asian and a
 * complex-script face per slot, and a picker offering one font cannot mean
 * anything by the other two — leaving them is how a deck built elsewhere keeps
 * working for the scripts it was built for.
 */
export function setThemeFonts(pkg: OoxmlPackage, path: string, fonts: ThemeFontChange): boolean {
  const found = themeElements(pkg, path)
  if (found === null) return false

  const scheme = findChild(found.elements, 'a:fontScheme')
  if (scheme === undefined) return false

  let changed = false
  for (const [slot, family] of [
    ['a:majorFont', fonts.major],
    ['a:minorFont', fonts.minor],
  ] as const) {
    if (family === undefined) continue

    const font = findChild(scheme, slot)
    if (font === undefined) continue

    const latin = findChild(font, 'a:latin') ?? element('a:latin')
    setAttribute(latin, 'typeface', family)

    // `a:latin` comes first in `CT_FontCollection`, before ea, cs and the rest.
    upsertChild(font, latin, ['a:latin', 'a:ea', 'a:cs', 'a:font', 'a:extLst'])
    changed = true
  }

  if (changed) write(pkg, path, found.roots)
  return changed
}

/**
 * Sets the colours of a theme, by slot.
 *
 * A slot that is not named is left alone. `dk1` and `lt1` usually hold a system
 * colour — `windowText`, `window` — and setting one replaces it with the value
 * given, which is what a theme with its own dark and light says.
 */
export function setThemeColors(
  pkg: OoxmlPackage,
  path: string,
  colors: Partial<Record<ColorSlot, string>>,
): boolean {
  const found = themeElements(pkg, path)
  if (found === null) return false

  const scheme = findChild(found.elements, 'a:clrScheme')
  if (scheme === undefined) return false

  let changed = false
  for (const slot of COLOR_SLOTS) {
    const hex = colors[slot]
    if (hex === undefined) continue

    const value = element('a:srgbClr', { val: hex.replace('#', '').toUpperCase() })
    const existing = children(scheme).find((child) => tagName(child) === `a:${slot}`)

    if (existing === undefined) {
      upsertChild(
        scheme,
        element(`a:${slot}`, {}, [value]),
        COLOR_SLOTS.map((one) => `a:${one}`),
      )
    } else {
      children(existing).splice(0, children(existing).length, value)
    }
    changed = true
  }

  if (changed) write(pkg, path, found.roots)
  return changed
}

/** The name a theme goes by, which is what a gallery shows as "in use". */
export function setThemeName(pkg: OoxmlPackage, path: string, name: string): boolean {
  const found = themeElements(pkg, path)
  if (found === null) return false

  setAttribute(found.theme, 'name', name)
  write(pkg, path, found.roots)
  return true
}
