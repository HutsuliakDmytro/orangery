import { EMU_PER_INCH } from '@orangery/ooxml-drawingml'

/**
 * OpenDocument measures in whatever unit the writer felt like.
 *
 * `svg:width="20cm"`, `"7.5in"`, `"540pt"` are all the same frame, and a file
 * from one program will not use the units of another. EMU is what the model
 * counts in, so everything is converted on the way in and one unit is chosen on
 * the way out.
 */

const PER_INCH: Readonly<Record<string, number>> = {
  in: 1,
  cm: 1 / 2.54,
  mm: 1 / 25.4,
  pt: 1 / 72,
  pc: 1 / 6,
  // Not a real unit in OpenDocument, but files written by web tooling use it
  // and the specification's own default pixel is 1/96 inch.
  px: 1 / 96,
}

/** A length as EMU, or null when it is missing or in a unit we cannot read. */
export function lengthToEmu(value: string | undefined): number | null {
  if (value === undefined) return null

  const match = /^\s*(-?[\d.]+)\s*([a-z]*)\s*$/iu.exec(value)
  const amount = Number(match?.[1])
  if (match === null || !Number.isFinite(amount)) return null

  const unit = (match[2] ?? '').toLowerCase()
  // A bare number means inches nowhere; treat it as points, which is what the
  // one format that omits units (older Impress) meant by it.
  const perInch = unit === '' ? PER_INCH['pt'] : PER_INCH[unit]
  if (perInch === undefined) return null

  return Math.round(amount * perInch * EMU_PER_INCH)
}

/**
 * EMU as centimetres, which is what Impress writes.
 *
 * Three decimals is a hundredth of a millimetre — below anything a projector or
 * a printer can show, and short enough that the file stays readable.
 */
export function emuToLength(emu: number): string {
  return `${((emu / EMU_PER_INCH) * 2.54).toFixed(3)}cm`
}
