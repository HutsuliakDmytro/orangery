import { attribute, children, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * A DrawingML colour, kept as the file states it.
 *
 * A theme colour stays symbolic — `accent1`, not `#4F81BD` — and is resolved to
 * RGB only when something is drawn. That is what lets changing the deck's theme
 * recolour it the way PowerPoint does; resolving at parse time would bake
 * today's palette into the model and, on save, into the file.
 */

export type ColorSource =
  | { kind: 'srgb'; hex: string }
  /** `accent1`, `tx1`, `phClr`, … Resolved through the theme and the colour map. */
  | { kind: 'scheme'; name: string }
  /** `windowText`, `window`. Carries the last value the host computed. */
  | { kind: 'system'; name: string; lastHex: string | null }
  /** A named preset such as `cornflowerBlue`. */
  | { kind: 'preset'; name: string }

/**
 * A modifier applied to the source colour.
 *
 * Percentages arrive in thousandths — `60000` is 60% — and order matters, so
 * they are kept as written rather than folded together.
 */
export interface ColorTransform {
  kind: 'tint' | 'shade' | 'lumMod' | 'lumOff' | 'satMod' | 'satOff' | 'alpha'
  /** Fraction of one, converted from the thousandths the file uses. */
  value: number
}

export interface Color {
  source: ColorSource
  transforms: ColorTransform[]
}

export interface ResolvedColor {
  /** `#RRGGBB`. */
  hex: string
  /** 0 to 1. */
  alpha: number
}

const SOURCES = new Set(['a:srgbClr', 'a:schemeClr', 'a:sysClr', 'a:prstClr', 'a:hslClr'])
const TRANSFORMS = new Set(['tint', 'shade', 'lumMod', 'lumOff', 'satMod', 'satOff', 'alpha'])

const thousandths = (value: string | undefined): number => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed / 100000 : 1
}

/** Reads a colour element — `a:srgbClr`, `a:schemeClr`, `a:sysClr`, `a:prstClr`. */
export function readColor(element: XmlNode): Color | null {
  const tag = tagName(element)
  const value = attribute(element, 'val')

  const source = ((): ColorSource | null => {
    switch (tag) {
      case 'a:srgbClr':
        return value === undefined ? null : { kind: 'srgb', hex: `#${value.toUpperCase()}` }
      case 'a:schemeClr':
        return value === undefined ? null : { kind: 'scheme', name: value }
      case 'a:sysClr': {
        const last = attribute(element, 'lastClr')
        return value === undefined
          ? null
          : {
              kind: 'system',
              name: value,
              lastHex: last === undefined ? null : `#${last.toUpperCase()}`,
            }
      }
      case 'a:prstClr':
        return value === undefined ? null : { kind: 'preset', name: value }
      default:
        return null
    }
  })()

  if (source === null) return null

  const transforms: ColorTransform[] = []
  for (const child of children(element)) {
    const name = (tagName(child) ?? '').replace(/^a:/u, '')
    if (!TRANSFORMS.has(name)) continue
    transforms.push({
      kind: name as ColorTransform['kind'],
      value: thousandths(attribute(child, 'val')),
    })
  }

  return { source, transforms }
}

/** The colour inside a container such as `a:solidFill` or `a:clrScheme`'s slots. */
export function readColorChild(parent: XmlNode): Color | null {
  const element = children(parent).find((child) => SOURCES.has(tagName(child) ?? ''))
  return element === undefined ? null : readColor(element)
}

// --- resolution -------------------------------------------------------------

const clamp = (value: number, low = 0, high = 1) => Math.min(Math.max(value, low), high)

function toRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.replace('#', ''), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

function toHex([r, g, b]: [number, number, number]): string {
  const part = (channel: number) =>
    Math.round(clamp(channel, 0, 255))
      .toString(16)
      .padStart(2, '0')
      .toUpperCase()
  return `#${part(r)}${part(g)}${part(b)}`
}

/** HSL with all three in 0..1, which is the space luminance and saturation act in. */
function toHsl([r, g, b]: [number, number, number]): [number, number, number] {
  const [red, green, blue] = [r / 255, g / 255, b / 255]
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const lightness = (max + min) / 2

  if (max === min) return [0, 0, lightness]

  const delta = max - min
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)
  const hue =
    max === red
      ? ((green - blue) / delta + (green < blue ? 6 : 0)) / 6
      : max === green
        ? ((blue - red) / delta + 2) / 6
        : ((red - green) / delta + 4) / 6

  return [hue, saturation, lightness]
}

function fromHsl([hue, saturation, lightness]: [number, number, number]): [number, number, number] {
  if (saturation === 0) {
    const grey = lightness * 255
    return [grey, grey, grey]
  }

  const q =
    lightness < 0.5 ? lightness * (1 + saturation) : lightness + saturation - lightness * saturation
  const p = 2 * lightness - q

  const channel = (offset: number) => {
    let t = hue + offset
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }

  return [channel(1 / 3) * 255, channel(0) * 255, channel(-1 / 3) * 255]
}

/**
 * Applies the modifiers in the order the file lists them.
 *
 * `tint` and `shade` act on the colour channels — toward white and toward black
 * — while `lumMod`, `lumOff`, `satMod` and `satOff` act in HSL, which is where
 * luminance and saturation mean anything. The spec defines tint and shade over
 * linear values; this applies them to sRGB, which is what matches PowerPoint's
 * output for the theme variants decks actually use. Exact agreement on unusual
 * colours is unverified until we can compare renders.
 */
function applyTransforms(hex: string, transforms: readonly ColorTransform[]): ResolvedColor {
  let rgb = toRgb(hex)
  let alpha = 1

  for (const transform of transforms) {
    switch (transform.kind) {
      case 'alpha':
        alpha = clamp(transform.value)
        break
      case 'tint':
        rgb = rgb.map((channel) => channel * transform.value + 255 * (1 - transform.value)) as [
          number,
          number,
          number,
        ]
        break
      case 'shade':
        rgb = rgb.map((channel) => channel * transform.value) as [number, number, number]
        break
      default: {
        const [hue, saturation, lightness] = toHsl(rgb)
        const next: [number, number, number] = [hue, saturation, lightness]

        if (transform.kind === 'lumMod') next[2] = clamp(lightness * transform.value)
        if (transform.kind === 'lumOff') next[2] = clamp(lightness + transform.value)
        if (transform.kind === 'satMod') next[1] = clamp(saturation * transform.value)
        if (transform.kind === 'satOff') next[1] = clamp(saturation + transform.value)

        rgb = fromHsl(next)
      }
    }
  }

  return { hex: toHex(rgb), alpha }
}

/** Presets we answer for; anything else resolves to null rather than a guess. */
const PRESETS: Readonly<Record<string, string>> = {
  black: '#000000',
  white: '#FFFFFF',
  red: '#FF0000',
  green: '#008000',
  blue: '#0000FF',
  yellow: '#FFFF00',
  gray: '#808080',
  grey: '#808080',
}

export interface ColorContext {
  /** The theme's `a:clrScheme`, by slot name (`dk1`, `accent1`, …). */
  scheme: ReadonlyMap<string, Color>
  /**
   * The master's `p:clrMap`: `tx1` → `dk1`, `bg1` → `lt1`, and so on.
   *
   * Without it a `schemeClr val="tx1"` finds nothing, because the scheme has no
   * `tx1` — the names a shape uses and the names a theme defines are two
   * different vocabularies joined by this map.
   */
  map: ReadonlyMap<string, string>
  /** What `phClr` means — the colour the style reference was invoked with. */
  placeholderColor?: Color
}

/** Resolves a colour to RGB for drawing. Never called on the way to a file. */
export function resolveColor(color: Color, context: ColorContext): ResolvedColor | null {
  const base = ((): { hex: string; extra: readonly ColorTransform[] } | null => {
    switch (color.source.kind) {
      case 'srgb':
        return { hex: color.source.hex, extra: [] }
      case 'system':
        return color.source.lastHex === null ? null : { hex: color.source.lastHex, extra: [] }
      case 'preset': {
        const hex = PRESETS[color.source.name.toLowerCase()]
        return hex === undefined ? null : { hex, extra: [] }
      }
      case 'scheme': {
        if (color.source.name === 'phClr') {
          const placeholder = context.placeholderColor
          if (placeholder === undefined) return null
          const resolved = resolveColor(placeholder, { ...context, placeholderColor: undefined })
          return resolved === null ? null : { hex: resolved.hex, extra: [] }
        }

        const slot = context.map.get(color.source.name) ?? color.source.name
        const defined = context.scheme.get(slot)
        if (defined === undefined) return null

        // The slot may itself be a sysClr with transforms of its own.
        const resolved = resolveColor(defined, { ...context, placeholderColor: undefined })
        return resolved === null ? null : { hex: resolved.hex, extra: [] }
      }
    }
  })()

  if (base === null) return null
  return applyTransforms(base.hex, [...base.extra, ...color.transforms])
}
