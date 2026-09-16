import { attribute, children, findChild, parseXml, tagName } from './xml'

/**
 * Font resolution for OOXML documents.
 *
 * Two problems to solve. First, `w:rFonts` may name a *theme* font
 * (`w:asciiTheme="minorHAnsi"`) rather than a family, which has to be looked up
 * in `word/theme/theme1.xml`. Second, the named family often does not exist on
 * the current OS — a Windows document on macOS names Calibri, which is not
 * installed. Substituting a metric-compatible font keeps line breaks close to
 * the original; substituting an arbitrary one does not.
 *
 * The document always keeps the original family name: substitution is a
 * rendering decision, never a change to the file.
 */

export type ThemeFontSlot = 'majorHAnsi' | 'minorHAnsi' | 'majorBidi' | 'minorBidi'

export interface ThemeFonts {
  /** Heading font, `w:majorFont`. */
  major: string | null
  /** Body font, `w:minorFont`. */
  minor: string | null
}

/**
 * Metric-compatible substitutes. Each row renders at the same widths as the
 * font it replaces, so a document does not reflow when opened elsewhere.
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

export function parseThemeFonts(xml: string): ThemeFonts {
  const roots = parseXml(xml)
  const theme = roots.find((node) => tagName(node) === 'a:theme')
  if (!theme) return { major: null, minor: null }

  const elements = findChild(theme, 'a:themeElements')
  const scheme = elements ? findChild(elements, 'a:fontScheme') : undefined
  if (!scheme) return { major: null, minor: null }

  const latinOf = (slot: string): string | null => {
    const font = findChild(scheme, slot)
    const latin = font ? findChild(font, 'a:latin') : undefined
    const typeface = latin ? attribute(latin, 'typeface') : undefined
    return typeface !== undefined && typeface !== '' ? typeface : null
  }

  return { major: latinOf('a:majorFont'), minor: latinOf('a:minorFont') }
}

/** Resolves a theme slot to the family the theme declares for it. */
export function resolveThemeFont(theme: ThemeFonts, slot: string | undefined): string | null {
  if (slot === undefined) return null
  return slot.startsWith('major') ? theme.major : theme.minor
}

/**
 * The CSS stack for a family named in the document: the family itself first —
 * it may well be installed — then metric-compatible substitutes, then a generic.
 */
export function fontStackFor(family: string): string {
  const substitutes = SUBSTITUTIONS[family.toLowerCase()] ?? []
  const generic = /mono|courier|consolas/i.test(family)
    ? 'monospace'
    : /times|georgia|garamond|book|serif|cambria|caladea/i.test(family)
      ? 'serif'
      : 'sans-serif'

  return [family, ...substitutes, generic].map(quoteIfNeeded).join(', ')
}

function quoteIfNeeded(family: string): string {
  if (family === 'serif' || family === 'sans-serif' || family === 'monospace') return family
  return /^[\w-]+$/.test(family) ? family : `'${family}'`
}

/** Families named in `word/fontTable.xml`, which lists every font the file uses. */
export function parseFontTable(xml: string): string[] {
  const root = parseXml(xml).find((node) => tagName(node) === 'w:fonts')
  if (!root) return []

  const families: string[] = []
  for (const node of children(root)) {
    if (tagName(node) !== 'w:font') continue
    const name = attribute(node, 'w:name')
    if (name !== undefined && name !== '') families.push(name)
  }
  return families
}
