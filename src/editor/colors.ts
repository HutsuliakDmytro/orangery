/**
 * Colour palette for text and highlight pickers.
 *
 * The grid mirrors Google Docs: a greyscale row followed by hue columns in five
 * tints. Familiar layout beats a novel one (CLAUDE.md "Familiar, not novel").
 * These are document colours and have nothing to do with the app's theme tokens.
 */

export const GREYSCALE: readonly string[] = [
  '#000000',
  '#434343',
  '#666666',
  '#999999',
  '#B7B7B7',
  '#CCCCCC',
  '#D9D9D9',
  '#EFEFEF',
  '#F3F3F3',
  '#FFFFFF',
]

export const HUES: readonly (readonly string[])[] = [
  ['#980000', '#CC0000', '#E06666', '#EA9999', '#F4CCCC'],
  ['#FF0000', '#FF6D01', '#F6B26B', '#F9CB9C', '#FCE5CD'],
  ['#FF9900', '#FFD966', '#FFE599', '#FFF2CC', '#FFFBE6'],
  ['#00FF00', '#6AA84F', '#93C47D', '#B6D7A8', '#D9EAD3'],
  ['#00FFFF', '#45818E', '#76A5AF', '#A2C4C9', '#D0E0E3'],
  ['#0000FF', '#3C78D8', '#6D9EEB', '#A4C2F4', '#C9DAF8'],
  ['#9900FF', '#674EA7', '#8E7CC3', '#B4A7D6', '#D9D2E9'],
  ['#FF00FF', '#A64D79', '#C27BA0', '#D5A6BD', '#EAD1DC'],
]

export const DEFAULT_TEXT_COLOR = '#000000'

/** Highlighter colours, matching what Word's marker offers. */
export const HIGHLIGHT_COLORS: readonly string[] = [
  '#FFFF00',
  '#00FF00',
  '#00FFFF',
  '#FF00FF',
  '#0000FF',
  '#FF0000',
  '#000080',
  '#008080',
  '#008000',
  '#800080',
  '#800000',
  '#808000',
  '#C0C0C0',
  '#808080',
  '#000000',
]

const HEX_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i

export function isValidHex(value: string): boolean {
  return HEX_PATTERN.test(value.trim())
}

/** Expands `#abc` to `#AABBCC`; returns null when the input is not a hex colour. */
export function normalizeHex(value: string): string | null {
  const trimmed = value.trim()
  if (!isValidHex(trimmed)) return null

  const digits = trimmed.slice(1)
  // Hex digits are ASCII, so indexing by code unit is safe here.
  const full = digits.length === 3 ? digits.replace(/([0-9a-f])/gi, '$1$1') : digits

  return `#${full.toUpperCase()}`
}

/**
 * Picks black or white text for a swatch background, so a label stays readable
 * on both ends of the palette. Uses the WCAG relative-luminance formula.
 */
export function contrastingText(hex: string): '#000000' | '#FFFFFF' {
  const normalized = normalizeHex(hex)
  if (!normalized) return '#000000'

  const channel = (offset: number): number => {
    const value = Number.parseInt(normalized.slice(offset, offset + 2), 16) / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }

  const luminance = 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5)
  return luminance > 0.179 ? '#000000' : '#FFFFFF'
}

/** Swatch grid for the text-colour picker: greyscale strip, then hue rows. */
export const TEXT_COLOR_SWATCHES: readonly (readonly string[])[] = [GREYSCALE, ...HUES]
