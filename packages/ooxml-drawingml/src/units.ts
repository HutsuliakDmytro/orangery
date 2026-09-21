/**
 * DrawingML measures in EMUs — English Metric Units, 914400 per inch.
 *
 * The number is chosen so that both inches and centimetres divide evenly into
 * it, which is why every coordinate in a drawing is an integer. Decks keep
 * every shape position and size in these; documents use them for the size of a
 * picture and for little else.
 */

export const EMU_PER_INCH = 914400
export const EMU_PER_POINT = EMU_PER_INCH / 72
export const EMU_PER_CENTIMETRE = 360000

/**
 * How many EMU a CSS pixel is worth.
 *
 * A format that measures in EMU has no pixels in it, and this is not about the
 * file: it is the number a renderer needs when it hands a piece of a drawing to
 * the browser's text layout, which measures in CSS pixels and nothing else. A
 * CSS pixel is a ninety-sixth of an inch by definition, so the conversion is
 * exact rather than a matter of the screen.
 *
 * Why it matters: a slide's text cannot be laid out in EMU. A 44-point title is
 * 558800 EMU, and Blink clamps `font-size` at ten thousand pixels — so text in
 * EMU comes out of Chromium at a fiftieth of its size, which is to say invisible,
 * and out of a rasteriser as nothing at all. Text is laid out in pixels and the
 * drawing is scaled back up around it.
 */
export const EMU_PER_PIXEL = EMU_PER_INCH / 96

export function emuToPoints(emu: number): number {
  return Math.round((emu / EMU_PER_POINT) * 100) / 100
}

export function pointsToEmu(points: number): number {
  return Math.round(points * EMU_PER_POINT)
}

/**
 * Scales a picture down to fit a width, as Word and PowerPoint both do when
 * something too large is inserted. An image that already fits is left alone —
 * enlarging it would be an edit nobody asked for.
 */
export function fitWithin(
  natural: { width: number; height: number },
  maxWidth: number,
): { width: number; height: number } {
  if (natural.width <= 0 || natural.height <= 0) return { width: maxWidth, height: maxWidth }
  if (natural.width <= maxWidth) return natural

  const scale = maxWidth / natural.width
  return {
    width: Math.round(maxWidth * 100) / 100,
    height: Math.round(natural.height * scale * 100) / 100,
  }
}
