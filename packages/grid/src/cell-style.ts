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

/**
 * A bar across a cell, behind whatever is written in it.
 *
 * How long it is has already been decided: the grid is handed a proportion,
 * not a value and a range, because what a value is worth against its
 * neighbours is a question about the file.
 */
export interface CellBar {
  color: string
  /** How much of the cell it fills, from 0 to 1. */
  proportion: number
}

/**
 * A small mark at the left of a cell.
 *
 * Shapes rather than Excel's icon-set names: the grid knows how to draw an
 * arrow and a circle, and which of them a `3TrafficLights1` amounts to is the
 * business of whoever read the file. That keeps the same grid usable by
 * something whose icons come from somewhere else entirely.
 */
export type IconShape =
  | 'arrow'
  | 'triangle'
  | 'dash'
  | 'circle'
  | 'flag'
  | 'diamond'
  | 'check'
  | 'cross'
  | 'exclamation'
  | 'bars'
  | 'boxes'
  | 'pie'
  | 'star'

export interface CellIcon {
  shape: IconShape
  color: string
  /** Which way an arrow or a triangle points. */
  direction?: 'up' | 'upRight' | 'right' | 'downRight' | 'down'
  /** For the shapes that count — bars, boxes, quarters, stars. */
  filled?: number
  steps?: number
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
  /** Drawn over the background and under the text. */
  bar?: CellBar
  /** Drawn at the left, with the text moved along to make room. */
  icon?: CellIcon
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
