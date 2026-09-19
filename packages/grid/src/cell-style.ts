/**
 * What a cell looks like, as far as a grid is concerned.
 *
 * Deliberately smaller than what a workbook can say. The grid draws text in a
 * box: a font, a colour, something behind it, lines around it, and where the
 * text sits in the box. Everything a spreadsheet knows beyond that — themes,
 * named styles, conditional rules, the cascade — is resolved before it gets
 * here, by whoever knows about workbooks.
 *
 * That is the seam: the grid stays a grid, and the app that owns the file
 * decides what a style means.
 */

export interface CellBorders {
  left: string | null
  right: string | null
  top: string | null
  bottom: string | null
}

export interface CellStyle {
  /** A CSS font shorthand, because that is what a canvas takes. */
  font?: string
  color?: string
  background?: string
  borders?: CellBorders
  /** `left`, `center`, `right`; unset means the grid decides by the value. */
  align?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  /** In characters, each about three spaces wide, as a spreadsheet counts. */
  indent?: number
  wrap?: boolean
}

/**
 * Where a value sits when nothing says otherwise.
 *
 * Numbers right, text left — the oldest convention in spreadsheets, and the
 * one that makes a column of figures readable: the digits line up under each
 * other, and a number that landed in a text cell is visible at a glance
 * because it is on the wrong side.
 */
export const defaultAlign = (value: string | null): 'left' | 'right' => {
  if (value === null || value === '') return 'left'
  return /^[-+]?[\d\s,.']+%?$/u.test(value.trim()) ? 'right' : 'left'
}
