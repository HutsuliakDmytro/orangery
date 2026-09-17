import { attribute, children, findChild, parseXml, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { readColorChild } from './color'
import type { Color } from './color'

/**
 * The theme: the palette and the two typefaces everything else refers to.
 *
 * A document and a deck carry the same `a:theme` part and mean the same thing
 * by it. A shape says `accent1` or `+mn-lt` and the theme says what that is,
 * which is how changing the theme restyles the whole file at once.
 */

export interface Theme {
  name: string
  /** `a:clrScheme` by slot: `dk1`, `lt1`, `dk2`, `lt2`, `accent1`…`accent6`, `hlink`, `folHlink`. */
  colors: Map<string, Color>
  fonts: ThemeFonts
}

export interface ThemeFonts {
  /** Headings, `a:majorFont`. */
  major: string | null
  /** Body text, `a:minorFont`. */
  minor: string | null
}

const EMPTY: Theme = { name: '', colors: new Map(), fonts: { major: null, minor: null } }

function latinOf(scheme: XmlNode, slot: string): string | null {
  const font = findChild(scheme, slot)
  const latin = font === undefined ? undefined : findChild(font, 'a:latin')
  const typeface = latin === undefined ? undefined : attribute(latin, 'typeface')
  return typeface !== undefined && typeface !== '' ? typeface : null
}

export function parseTheme(xml: string): Theme {
  const theme = parseXml(xml).find((node) => tagName(node) === 'a:theme')
  if (theme === undefined) return EMPTY

  const elements = findChild(theme, 'a:themeElements')
  if (elements === undefined) return { ...EMPTY, name: attribute(theme, 'name') ?? '' }

  const colors = new Map<string, Color>()
  const scheme = findChild(elements, 'a:clrScheme')
  if (scheme !== undefined) {
    for (const slot of children(scheme)) {
      const name = (tagName(slot) ?? '').replace(/^a:/u, '')
      const color = readColorChild(slot)
      if (name !== '' && color !== null) colors.set(name, color)
    }
  }

  const fontScheme = findChild(elements, 'a:fontScheme')

  return {
    name: attribute(theme, 'name') ?? '',
    colors,
    fonts:
      fontScheme === undefined
        ? { major: null, minor: null }
        : { major: latinOf(fontScheme, 'a:majorFont'), minor: latinOf(fontScheme, 'a:minorFont') },
  }
}

/**
 * Resolves a theme font reference to the family the theme declares.
 *
 * Both formats spell the reference their own way — `+mj-lt` and `+mn-lt` in a
 * deck, `majorHAnsi` and `minorHAnsi` in a document — and both mean the same
 * two slots.
 */
export function resolveThemeFont(fonts: ThemeFonts, reference: string | undefined): string | null {
  if (reference === undefined) return null
  return /^\+?(mj|major)/u.test(reference) ? fonts.major : fonts.minor
}

/**
 * Metric-compatible substitutes. Each row renders at the same widths as the
 * font it replaces, so a file does not reflow when opened elsewhere.
 */
const SUBSTITUTIONS: Readonly<Record<string, readonly string[]>> = {
  calibri: ['Carlito', 'Liberation Sans', 'Helvetica', 'Arial'],
  cambria: ['Caladea', 'Liberation Serif', 'Georgia', 'Times New Roman'],
  'times new roman': ['Liberation Serif', 'Times', 'Georgia'],
  arial: ['Liberation Sans', 'Helvetica'],
  helvetica: ['Arial', 'Liberation Sans'],
  'courier new': ['Liberation Mono', 'Courier', 'monospace'],
  georgia: ['Liberation Serif', 'Times New Roman'],
  verdana: ['DejaVu Sans', 'Liberation Sans', 'Arial'],
  tahoma: ['DejaVu Sans', 'Liberation Sans', 'Arial'],
  'segoe ui': ['Liberation Sans', 'Helvetica Neue', 'Arial'],
  // Symbol fonts carry bullet glyphs; there is no metric equivalent, so the
  // fallback only has to render *something* rather than a tofu box.
  symbol: ['Apple Symbols', 'Segoe UI Symbol'],
  wingdings: ['Apple Symbols', 'Segoe UI Symbol'],
}

function quoteIfNeeded(family: string): string {
  if (family === 'serif' || family === 'sans-serif' || family === 'monospace') return family
  return /^[\w-]+$/u.test(family) ? family : `'${family}'`
}

/**
 * The CSS stack for a family named in the file: the family itself first — it
 * may well be installed — then metric-compatible substitutes, then a generic.
 *
 * The file always keeps the original name. Substitution is a rendering
 * decision and never a change to what was written.
 */
export function fontStackFor(family: string): string {
  const substitutes = SUBSTITUTIONS[family.toLowerCase()] ?? []
  const generic = /mono|courier|consolas/iu.test(family)
    ? 'monospace'
    : /times|georgia|garamond|book|serif|cambria|caladea/iu.test(family)
      ? 'serif'
      : 'sans-serif'

  return [family, ...substitutes, generic].map(quoteIfNeeded).join(', ')
}
