import { ICON_GUTTER } from './icon'
import { INDENT, PADDING, lettersOf, lineHeightOf, wrapText } from './text'
import type { CellStyle } from './cell-style'

/**
 * How wide a column, or how tall a row, would have to be.
 *
 * The one question only the grid can answer. A workbook knows what is in a
 * cell; what a cell *needs* is a question about the font it is painted in, and
 * the font, the canvas and the metrics are all here. So the app says which
 * cells to look at and what is in them, and the grid says how much room they
 * want — which is exactly the split everywhere else in this package.
 *
 * Measured in unzoomed units, because a width is written into the file and a
 * file does not know what anybody was zoomed to.
 */

/** A cell as a measurement sees it: some text, and how it is painted. */
export interface FitCell {
  text: string
  style: CellStyle | null
  /** The room it has across, for a row's height — a wrap needs a width. */
  width?: number
}

/** Room to the right of the widest value, so the column does not look packed. */
const SLACK = 3

const fontOf = (cell: FitCell, base: string): string => cell.style?.font ?? base

/** The space a value takes along the line, runs and all. */
function lengthOf(context: CanvasRenderingContext2D, cell: FitCell, base: string): number {
  const runs = cell.style?.runs
  if (runs !== undefined && runs.length > 0) {
    return runs.reduce((total, run) => {
      context.font = run.font ?? fontOf(cell, base)
      return total + context.measureText(run.text).width
    }, 0)
  }

  context.font = fontOf(cell, base)
  return context.measureText(cell.text).width
}

/** Everything a cell keeps beside its text: the padding, an indent, an icon. */
const furnitureOf = (cell: FitCell): number =>
  PADDING * 2 +
  (cell.style?.indent ?? 0) * INDENT +
  (cell.style?.icon === undefined ? 0 : ICON_GUTTER)

/**
 * The width the widest of these cells wants.
 *
 * Wrapped cells are left out. A cell told to wrap has already been told how to
 * fit — widening the column until its whole string is on one line is undoing
 * the instruction rather than obeying it — and a paragraph in a cell would
 * otherwise make a column the width of the paragraph.
 *
 * Turned text is counted as it lies: a name at sixty degrees takes a fraction
 * of the room across that the same name takes level, and that fraction is
 * what the column has to hold.
 */
export function widthNeeded(
  context: CanvasRenderingContext2D,
  cells: readonly FitCell[],
  font: string,
): number {
  const previous = context.font
  let widest = 0

  for (const cell of cells) {
    if (cell.text === '' || cell.style?.wrap === true) continue

    const length = lengthOf(context, cell, font)
    const across =
      cell.style?.rotation === undefined || cell.style.rotation === 0
        ? length
        : projected(cell, length, lineHeightOf(context.font), cell.style.rotation).across

    widest = Math.max(widest, across + furnitureOf(cell))
  }

  context.font = previous
  return widest === 0 ? 0 : Math.ceil(widest + SLACK)
}

/**
 * The height the tallest of these cells wants.
 *
 * This is where wrapping counts: a wrapped cell in a column of a known width
 * needs as many lines as the words come to, which is the whole reason Excel
 * writes a height into a row it has wrapped.
 */
export function heightNeeded(
  context: CanvasRenderingContext2D,
  cells: readonly FitCell[],
  font: string,
): number {
  const previous = context.font
  let tallest = 0

  for (const cell of cells) {
    if (cell.text === '') continue

    context.font = fontOf(cell, font)
    const step = lineHeightOf(context.font)

    const rotation = cell.style?.rotation
    if (rotation !== undefined && rotation !== 0) {
      const { down } = projected(cell, lengthOf(context, cell, font), step, rotation)
      tallest = Math.max(tallest, down)
      continue
    }

    const room = (cell.width ?? 0) - furnitureOf(cell)
    const lines =
      cell.style?.wrap === true && room > 0 ? wrapText(context, cell.text, room).length : 1

    tallest = Math.max(tallest, step * lines)
  }

  context.font = previous
  return tallest === 0 ? 0 : Math.ceil(tallest + PADDING)
}

/**
 * What a turned value takes across and down.
 *
 * A line of text at an angle is the diagonal of a box: its length leans into
 * both directions, and the height of the line leans into the other one.
 * Stacked letters are not turned at all — they are a column one letter wide
 * and as many letters tall.
 */
function projected(
  cell: FitCell,
  length: number,
  step: number,
  rotation: number | 'stacked',
): { across: number; down: number } {
  // Stacked letters are a column one letter wide and a letter tall each,
  // which is a different shape from the same word laid on its side.
  if (rotation === 'stacked') {
    return { across: step, down: step * lettersOf(cell.text).length }
  }

  const radians = (Math.abs(rotation) * Math.PI) / 180
  return {
    across: Math.abs(length * Math.cos(radians)) + Math.abs(step * Math.sin(radians)),
    down: Math.abs(length * Math.sin(radians)) + Math.abs(step * Math.cos(radians)),
  }
}
