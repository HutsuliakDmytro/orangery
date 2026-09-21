import { EMU_PER_PIXEL } from '@orangery/ooxml-drawingml'

/**
 * Working out how far text has to shrink to fit the box it is in.
 *
 * PowerPoint shrinks text that overflows and writes down what it shrank it to,
 * in `a:normAutofit/@fontScale`. Reading that back is what we already did; this
 * is the other half — deciding a new one after the text has changed, because a
 * scale worked out for a sentence that is no longer there is a wrong answer
 * rather than a missing one.
 *
 * The ladder is PowerPoint's own: seven and a half percent a step, down to a
 * quarter. Landing on the same rungs matters because the number goes into the
 * file, and a deck that says 91.3% is a deck somebody else's PowerPoint will
 * quietly round.
 */

/** The scales the format is written with, largest first. */
export const SCALES: readonly number[] = [
  100000, 92500, 85000, 77500, 70000, 62500, 55000, 47500, 40000, 32500, 25000,
]

/**
 * How much of the box the text is allowed to fill before growing back.
 *
 * Without it, text that exactly fills its box would be told to grow, then be
 * told to shrink, for as long as anybody looked at it. The margin is what makes
 * the two answers agree: shrinking asks for a fit, growing asks for a fit with
 * room to spare, and no measurement can satisfy neither.
 */
const ROOM = 0.9

/** The largest scale on the ladder that is no larger than `wanted`. */
function snap(wanted: number): number {
  return SCALES.find((scale) => scale <= wanted) ?? SCALES[SCALES.length - 1] ?? 100000
}

/**
 * The scale the text should be drawn at, given what it measured at the one in
 * use. Answers the current scale when it is already right.
 *
 * One step, not one rung at a time: text height is close enough to linear in
 * font size that the scale which would have fitted can be worked out directly,
 * and a search that stepped down a rung per render would redraw the slide ten
 * times to say what this says once.
 */
export function scaleFor(current: number, measured: { content: number; box: number }): number {
  if (measured.box <= 0 || measured.content <= 0) return current

  if (measured.content > measured.box) {
    return snap((current * measured.box) / measured.content)
  }

  // Room to grow: only taken when there is enough of it that the answer will
  // not be "shrink again" on the next measurement.
  const wanted = snap((current * measured.box * ROOM) / measured.content)
  return wanted > current ? wanted : current
}

/** What PowerPoint keeps around the words of a shape that states nothing. */
export const DEFAULT_INSETS = { left: 91440, right: 91440, top: 45720, bottom: 45720 }

/**
 * The height a shape needs to hold its words.
 *
 * The words, plus the space the shape keeps around them — and that space is
 * the insets the file states, which are the same insets the renderer draws as
 * padding. It is not measured off the box.
 *
 * Measuring it is what this did first: `outer.clientHeight - inner.clientHeight`,
 * where `outer` is the shape. The shape's own height was therefore inside the
 * number, so what came out was a function of the height it was about to set —
 * measure, resize, measure again, resize again. On most decks that settled in
 * a pass or two and nobody could tell. On one it did not, and a loop between a
 * layout effect and the store is React's "maximum update depth exceeded": the
 * tree comes down, and a deck that cannot be opened at all is the worst thing
 * a reader can do.
 *
 * Nothing here reads the shape's height, which is the whole of why it settles.
 * What it depends on is the text and the width, and neither of those is what
 * this is about to change.
 */
export function heightForText(
  content: number,
  insets?: { top: number | null; bottom: number | null } | null,
): number {
  const top = insets?.top ?? DEFAULT_INSETS.top
  const bottom = insets?.bottom ?? DEFAULT_INSETS.bottom

  return Math.round(content * EMU_PER_PIXEL + top + bottom)
}
