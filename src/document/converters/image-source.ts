/**
 * Image addresses coming from a document we did not write.
 *
 * An opened HTML or Markdown file is untrusted input, and `<img src>` is a
 * place where a scheme handler gets to run. Only the addresses that name a
 * picture are carried into the document; the rest are reported and dropped,
 * the same way `normalizeUrl` treats links.
 */

/** Points per CSS pixel, which is the unit HTML sizes an image in. */
export const POINTS_PER_PIXEL = 0.75

export function safeImageSource(src: string): string | null {
  const trimmed = src.trim()
  if (trimmed === '') return null

  const scheme = /^([a-z][a-z0-9+.-]*):/iu.exec(trimmed)
  // No scheme: a path relative to the document. It cannot be resolved from a
  // file held in memory, so it will not display — but keeping the reference
  // means saving the file back does not erase it.
  if (scheme?.[1] === undefined) return trimmed

  switch (scheme[1].toLowerCase()) {
    case 'http':
    case 'https':
      return trimmed
    case 'data':
      // Inert in an `<img>` either way, but a data URL that is not a picture
      // has no business being carried into a document as one.
      return /^data:image\/[a-z0-9.+-]+[;,]/iu.test(trimmed) ? trimmed : null
    default:
      return null
  }
}

/** Reads a pixel size off an HTML attribute, in the points the editor uses. */
export function pixelsToPoints(value: string | null): number | null {
  if (value === null) return null

  const amount = Number.parseFloat(value)
  if (!Number.isFinite(amount) || amount <= 0) return null

  return Math.round(amount * POINTS_PER_PIXEL * 100) / 100
}

export function pointsToPixels(points: number): number {
  return Math.round(points / POINTS_PER_PIXEL)
}
