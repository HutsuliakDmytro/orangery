import { fillForReference, lineForReference } from '@orangery/ooxml-drawingml'
import type { Color, ColorContext, Fill, Line, Theme } from '@orangery/ooxml-drawingml'
import type { Shape } from './shape-tree'

/**
 * What a shape is actually drawn with.
 *
 * Most shapes in a real deck state no fill and no line. They carry a `p:style`
 * saying "the third fill of the theme, in accent1", and the theme writes that
 * fill in terms of `phClr` — a stand-in the reference fills. Reading the shape
 * alone therefore shows nothing, which is how a template's shapes end up drawn
 * blank.
 *
 * What the shape states wins; the reference only answers when it is silent.
 * And `{ kind: 'none' }` counts as stating something — a shape that says
 * `a:noFill` is transparent on purpose and must not be given the theme's fill.
 */

export interface ShapeLook {
  fill: Fill | null
  line: Line | null
  /**
   * What `phClr` stands for while resolving colours inside `fill` and `line`.
   *
   * Null when the look came from the shape itself, whose colours mean what they
   * say.
   */
  placeholderColor: Color | null
}

export function shapeLook(shape: Shape, theme: Theme | undefined): ShapeLook {
  const own = shape.properties

  const fromStyle =
    theme === undefined
      ? { fill: null, line: null }
      : {
          fill: fillForReference(theme.format, shape.style?.fill ?? null),
          line: lineForReference(theme.format, shape.style?.line ?? null),
        }

  const usesStyleFill = own?.fill == null
  const usesStyleLine = own?.line == null

  return {
    fill: usesStyleFill ? fromStyle.fill : own.fill,
    line: usesStyleLine ? fromStyle.line : own.line,
    placeholderColor: usesStyleFill ? (shape.style?.fill?.color ?? null) : null,
  }
}

/** The colour context for resolving what `shapeLook` returned. */
export function lookContext(base: ColorContext, look: ShapeLook): ColorContext {
  return look.placeholderColor === null
    ? base
    : { ...base, placeholderColor: look.placeholderColor }
}
