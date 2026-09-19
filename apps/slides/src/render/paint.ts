import { resolveColor } from '@orangery/ooxml-drawingml'
import type { Color, ColorContext, Fill, Line } from '@orangery/ooxml-drawingml'

/**
 * Fills and lines as SVG takes them.
 *
 * A gradient cannot be an attribute — it has to be an element in `<defs>` that
 * the shape points at — so this returns both the attributes and whatever
 * definitions they refer to, and the caller renders them together.
 */

export interface GradientDefinition {
  id: string
  /** 60000ths of a degree, clockwise from the x axis, as the file states it. */
  angle: number | null
  radial: boolean
  stops: { offset: number; color: string; opacity: number }[]
}

export interface Paint {
  fill: string
  fillOpacity: number
  stroke: string
  strokeOpacity: number
  strokeWidth: number
  strokeDasharray?: string
  strokeLinecap?: 'butt' | 'round' | 'square'
}

/** `a:prstDash` names, as multiples of the stroke width. */
const DASHES: Readonly<Record<string, string>> = {
  dot: '1 2',
  sysDot: '1 1',
  dash: '4 3',
  sysDash: '3 1',
  lgDash: '8 3',
  dashDot: '4 3 1 3',
  lgDashDot: '8 3 1 3',
  lgDashDotDot: '8 3 1 3 1 3',
}

const NONE = { paint: 'none', opacity: 1 }

function solidOf(color: Color | null, context: ColorContext): { paint: string; opacity: number } {
  if (color === null) return NONE
  const resolved = resolveColor(color, context)
  return resolved === null ? NONE : { paint: resolved.hex, opacity: resolved.alpha }
}

/**
 * Turns a fill into something SVG can use.
 *
 * A picture fill is not drawn yet and reads as no fill rather than as a colour
 * that was never in the file — showing the wrong colour is worse than showing
 * none, because it looks deliberate.
 */
export function fillPaint(
  fill: Fill | null,
  context: ColorContext,
  id: string,
): { paint: string; opacity: number; definition: GradientDefinition | null } {
  if (fill === null) return { ...NONE, definition: null }

  switch (fill.kind) {
    case 'solid':
      return { ...solidOf(fill.color, context), definition: null }

    case 'gradient': {
      const stops = fill.stops.map((stop) => {
        const { paint, opacity } = solidOf(stop.color, context)
        return { offset: stop.position, color: paint === 'none' ? '#000000' : paint, opacity }
      })
      if (stops.length === 0) return { ...NONE, definition: null }

      return {
        paint: `url(#${id})`,
        opacity: 1,
        definition: { id, angle: fill.angle, radial: fill.radial, stops },
      }
    }

    case 'pattern':
      // Approximated by its foreground until patterns are drawn properly: the
      // shape keeps its presence on the slide rather than vanishing.
      return { ...solidOf(fill.foreground, context), definition: null }

    default:
      // none, picture and group: nothing to paint with, at least not yet.
      return { ...NONE, definition: null }
  }
}

export function linePaint(
  line: Line | null,
  context: ColorContext,
  toPixels: (emu: number) => number,
): Pick<Paint, 'stroke' | 'strokeOpacity' | 'strokeWidth' | 'strokeDasharray' | 'strokeLinecap'> {
  if (line === null) {
    return { stroke: 'none', strokeOpacity: 1, strokeWidth: 0 }
  }

  const colour =
    line.fill?.kind === 'solid' ? solidOf(line.fill.color, context) : { paint: 'none', opacity: 1 }

  // A line with no width is not invisible: PowerPoint draws it hairline.
  const width = line.width === null ? 1 : Math.max(toPixels(line.width), 0.5)
  const dash = line.dash === null ? undefined : DASHES[line.dash]

  return {
    stroke: colour.paint,
    strokeOpacity: colour.opacity,
    strokeWidth: width,
    ...(dash === undefined
      ? {}
      : { strokeDasharray: dash.replace(/\d+/gu, (n) => String(Number(n) * width)) }),
    ...(line.cap === null
      ? {}
      : { strokeLinecap: line.cap === 'flat' ? ('butt' as const) : line.cap }),
  }
}

/**
 * The colour a piece of text is drawn in.
 *
 * A run that states no colour does not mean "whatever colour the window is".
 * Left to inherit, a slide's words take the colour of the app's chrome — on the
 * dark theme, near-white on a white slide, which is a deck rendered invisible
 * by a preference about the app (`CLAUDE.md`: the slide renders in its own
 * theme's colours, never tinted by the app's).
 *
 * What it means instead is `tx1`, the theme's text colour, which is what
 * PowerPoint falls back to and reaches through the master's colour map. Black
 * where even that is missing: a deck with no theme is still a deck with words
 * in it.
 */
export function textPaint(color: Color | null, context: ColorContext): string {
  const stated = solidOf(color, context)
  if (stated.paint !== 'none') return stated.paint

  const themed = solidOf({ source: { kind: 'scheme', name: 'tx1' }, transforms: [] }, context)
  return themed.paint === 'none' ? '#000000' : themed.paint
}
