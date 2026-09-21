import type { StyleColor } from './styles'

/**
 * What a cell's colour actually is.
 *
 * A workbook states colours four ways and only one of them is a colour: an RGB
 * hex, an index into the theme, an index into a palette from 1997, or the word
 * "automatic". The first is easy and the other three are the reason this file
 * exists.
 *
 * Resolved here and never on the way back into the file — a theme colour that
 * was saved as a hex is a cell that stops following the theme, which is the
 * same rule charts and shapes already follow.
 */

/**
 * The order Excel indexes the theme in, which is not the order the theme is
 * written in.
 *
 * The first two are swapped: `theme="0"` is the light background and
 * `theme="1"` is the dark text, while `a:clrScheme` lists `dk1` first. A
 * reader that trusted the file's order draws black text on black.
 */
const THEME_ORDER = [
  'lt1',
  'dk1',
  'lt2',
  'dk2',
  'accent1',
  'accent2',
  'accent3',
  'accent4',
  'accent5',
  'accent6',
  'hlink',
  'folHlink',
]

/**
 * The palette a workbook falls back to, which Excel has carried since 1997.
 *
 * Indexes 0 to 7 repeat 8 to 15 — a quirk of the original format that every
 * writer preserves. 64 and 65 are the system's own foreground and background,
 * which is to say the reader's, and are left for the caller to decide.
 */
const INDEXED = [
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '000000',
  'FFFFFF',
  'FF0000',
  '00FF00',
  '0000FF',
  'FFFF00',
  'FF00FF',
  '00FFFF',
  '800000',
  '008000',
  '000080',
  '808000',
  '800080',
  '008080',
  'C0C0C0',
  '808080',
  '9999FF',
  '993366',
  'FFFFCC',
  'CCFFFF',
  '660066',
  'FF8080',
  '0066CC',
  'CCCCFF',
  '000080',
  'FF00FF',
  'FFFF00',
  '00FFFF',
  '800080',
  '800000',
  '008080',
  '0000FF',
  '00CCFF',
  'CCFFFF',
  'CCFFCC',
  'FFFF99',
  '99CCFF',
  'FF99CC',
  'CC99FF',
  'FFCC99',
  '3366FF',
  '33CCCC',
  '99CC00',
  'FFCC00',
  'FF9900',
  'FF6600',
  '666699',
  '969696',
  '003366',
  '339966',
  '003300',
  '333300',
  '993300',
  '993366',
  '333399',
  '333333',
]

/** `FFRRGGBB` or `RRGGBB` as the six digits that matter. */
const sixOf = (hex: string): string | null => {
  const bare = hex.replace(/^#/u, '')
  if (/^[0-9a-fA-F]{8}$/u.test(bare)) return bare.slice(2).toUpperCase()
  return /^[0-9a-fA-F]{6}$/u.test(bare) ? bare.toUpperCase() : null
}

interface Hls {
  hue: number
  lightness: number
  saturation: number
}

function toHls(hex: string): Hls {
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255

  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2

  if (max === min) return { hue: 0, lightness, saturation: 0 }

  const span = max - min
  const saturation = lightness > 0.5 ? span / (2 - max - min) : span / (max + min)
  const hue =
    max === red
      ? (green - blue) / span + (green < blue ? 6 : 0)
      : max === green
        ? (blue - red) / span + 2
        : (red - green) / span + 4

  return { hue: hue / 6, lightness, saturation }
}

const channel = (p: number, q: number, t: number): number => {
  const at = t < 0 ? t + 1 : t > 1 ? t - 1 : t
  if (at < 1 / 6) return p + (q - p) * 6 * at
  if (at < 1 / 2) return q
  if (at < 2 / 3) return p + (q - p) * (2 / 3 - at) * 6
  return p
}

function toHex({ hue, lightness, saturation }: Hls): string {
  const pair = (value: number): string =>
    Math.round(Math.min(Math.max(value, 0), 1) * 255)
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()

  if (saturation === 0) return `${pair(lightness)}${pair(lightness)}${pair(lightness)}`

  const q =
    lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q

  return `${pair(channel(p, q, hue + 1 / 3))}${pair(channel(p, q, hue))}${pair(channel(p, q, hue - 1 / 3))}`
}

/**
 * A colour lightened or darkened, as the format defines it.
 *
 * Not a blend with white or black, which is the obvious guess and gives
 * visibly different colours: the tint moves the lightness in HLS, leaving the
 * hue and saturation where they were. −1 is black, +1 is white, and the
 * accents in every Office theme are shades of the same six colours made this
 * way.
 */
export function applyTint(hex: string, tint: number): string {
  const six = sixOf(hex)
  if (six === null || tint === 0) return six ?? hex.toUpperCase()

  const hls = toHls(six)
  const lightness = tint < 0 ? hls.lightness * (1 + tint) : hls.lightness * (1 - tint) + tint

  return toHex({ ...hls, lightness })
}

export interface ColorPalette {
  /** The theme's `a:clrScheme` by slot name, as hex without the alpha. */
  scheme: ReadonlyMap<string, string>
  /** What the system's own foreground and background are here. */
  foreground?: string
  background?: string
}

/**
 * A stated colour as six hex digits, or null where the file says nothing.
 *
 * Null rather than a default: what an unstated colour means depends on where
 * it is. An unstated font colour is the reader's text colour; an unstated
 * fill is no fill at all, which is not the same as a white one.
 */
export function resolveColor(color: StyleColor | null, palette: ColorPalette): string | null {
  if (color === null) return null

  switch (color.kind) {
    case 'rgb':
      return sixOf(color.hex)
    case 'theme': {
      const slot = THEME_ORDER[color.index]
      const hex = slot === undefined ? undefined : palette.scheme.get(slot)
      return hex === undefined ? null : applyTint(hex, color.tint)
    }
    case 'indexed': {
      if (color.index === 64) return palette.foreground ?? null
      if (color.index === 65) return palette.background ?? null
      return INDEXED[color.index] ?? null
    }
    case 'auto':
      return null
  }
}

/** The palette a workbook's theme provides, from a theme already parsed. */
export function paletteOf(
  theme: { colors: ReadonlyMap<string, { hex: string } | string> } | undefined,
  system: { foreground?: string; background?: string } = {},
): ColorPalette {
  const scheme = new Map<string, string>()

  for (const [slot, value] of theme?.colors ?? []) {
    const hex = sixOf(typeof value === 'string' ? value : value.hex)
    if (hex !== null) scheme.set(slot, hex)
  }

  return { scheme, ...system }
}
