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
