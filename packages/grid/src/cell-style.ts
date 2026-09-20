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

/**
 * A stretch of a value that looks different from the rest of it.
 *
 * A cell has one style, so a cell cannot be half bold; what can be is the
 * string in it. Resolved by the caller into the same shorthand the rest of a
 * cell's look uses, because a run's formatting is a question about the file.
 */
export interface StyledRun {
  text: string
  font?: string
  color?: string
}

export interface CellStyle {
  /** A CSS font shorthand, because that is what a canvas takes. */
  font?: string
  /**
   * Lines a font shorthand has no room for.
   *
   * A canvas draws text and nothing under or through it, so an underline and
   * a strikethrough are lines this has to draw itself — which means they
   * have to be said separately from the font they belong to.
   */
  underline?: 'single' | 'double'
  strike?: boolean
  color?: string
  background?: string
  borders?: CellBorders
  /** `left`, `center`, `right`; unset means the grid decides by the value. */
  align?: 'left' | 'center' | 'right'
  verticalAlign?: 'top' | 'middle' | 'bottom'
  /** In characters, each about three spaces wide, as a spreadsheet counts. */
  indent?: number
  wrap?: boolean
  /**
   * Degrees anticlockwise from level, or `stacked` for letters one under
   * another — which is a different thing from turning the words by ninety.
   */
  rotation?: number | 'stacked'
  /** Drawn over the background and under the text. */
  bar?: CellBar
  /** Drawn at the left, with the text moved along to make room. */
  icon?: CellIcon
  /**
   * The value in pieces, where the pieces are not all alike.
   *
   * The grid still asks `valueAt` for the words — a screen reader and a
   * keyboard need them — and draws these instead when they are here.
   */
  runs?: StyledRun[]
  /**
   * A small mark in the top-right corner, in this colour.
   *
   * What a spreadsheet uses to say "there is something here that is not the
   * value": a note, a comment, an error somebody chose to ignore. The grid
   * draws the corner; what it means is the caller's.
   */
  corner?: string
  /**
   * A filter arrow at the right of the cell.
   *
   * `on` when the column is filtering something, which is what tells somebody
   * that the rows they cannot see are missing on purpose.
   */
  filter?: { on: boolean }
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
