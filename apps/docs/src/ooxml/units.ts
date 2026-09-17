/**
 * OOXML measurement units.
 *
 * Word stores lengths in twips (1/20 pt), font sizes in half-points, and line
 * spacing in 240ths of a line. Conversions live here so no call site has to
 * remember which unit a given attribute uses.
 */

export const TWIPS_PER_POINT = 20
export const HALF_POINTS_PER_POINT = 2
export const LINE_UNITS_PER_LINE = 240

export function twipsToPoints(twips: number): number {
  return twips / TWIPS_PER_POINT
}

export function pointsToTwips(points: number): number {
  return Math.round(points * TWIPS_PER_POINT)
}

export function halfPointsToPoints(halfPoints: number): number {
  return halfPoints / HALF_POINTS_PER_POINT
}

export function pointsToHalfPoints(points: number): number {
  return Math.round(points * HALF_POINTS_PER_POINT)
}

export function lineUnitsToMultiplier(lineUnits: number): number {
  return Math.round((lineUnits / LINE_UNITS_PER_LINE) * 100) / 100
}

export function multiplierToLineUnits(multiplier: number): number {
  return Math.round(multiplier * LINE_UNITS_PER_LINE)
}

/** Parses an OOXML integer attribute, returning null rather than NaN. */
export function parseIntAttribute(value: string | undefined): number | null {
  if (value === undefined) return null
  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) ? parsed : null
}

/**
 * OOXML toggle properties: `<w:b/>` means on, `<w:b w:val="0"/>` means off.
 * Absent means "inherit", which the caller distinguishes by passing undefined.
 */
export function parseToggle(value: string | undefined): boolean {
  if (value === undefined) return true
  return value !== '0' && value.toLowerCase() !== 'false' && value.toLowerCase() !== 'off'
}

/** Word writes colours as six hex digits with no `#`, or the literal `auto`. */
export function parseColor(value: string | undefined): string | null {
  if (!value || value.toLowerCase() === 'auto') return null
  if (!/^[0-9a-f]{6}$/i.test(value)) return null
  return `#${value.toUpperCase()}`
}

export function formatColor(hex: string): string {
  return hex.replace(/^#/, '').toUpperCase()
}
