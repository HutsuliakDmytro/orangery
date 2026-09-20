import { defaultAlign } from './cell-style'
import type { CellStyle, StyledRun } from './cell-style'
import type { Rectangle } from './layout'

/**
 * A value, written in its cell.
 *
 * One place rather than three, because the three ways a spreadsheet writes in
 * a cell — along, wrapped, turned — differ only in where the pen goes. What
 * they share is everything else: the alignment, the indent, the room an icon
 * takes, and the clip that stops a long word from running into the neighbour.
 */

/** The space a cell keeps between its edge and its text. */
export const PADDING = 4

/** An indent is counted in characters, each about three spaces wide. */
export const INDENT = 9

/**
 * The letters of a value, as a reader counts them.
 *
 * Not code points: "ї" can be written as two of those and is one letter, and
 * a flag is a good many. A stacked cell that split them apart would stand
 * half a letter on top of the other half.
 */
const segmenter = new Intl.Segmenter()
export const lettersOf = (text: string): string[] =>
  [...segmenter.segment(text)].map((one) => one.segment)

export interface TextOptions {
  font: string
  color: string
  /** Room already taken at the left of the cell, by an icon. */
  gutter: number
}

export function drawCellText(
  context: CanvasRenderingContext2D,
  text: string,
  rect: Rectangle,
  style: CellStyle | null,
  options: TextOptions,
): void {
  context.save()
  context.beginPath()
  context.rect(rect.x, rect.y, rect.width, rect.height)
  context.clip()

  context.font = style?.font ?? options.font
  context.fillStyle = style?.color ?? options.color

  const runs = style?.runs ?? null

  if (style?.rotation !== undefined && style.rotation !== 0) {
    // Turned text is drawn as one piece. A rotated cell whose words change
    // font half way through is a case nobody has yet had, and inventing an
    // answer for it would be inventing the case as well.
    turned(context, text, rect, style)
  } else if (runs !== null && runs.length > 0) {
    inPieces(context, runs, rect, style, options)
  } else if (style?.wrap === true) {
    wrapped(context, text, rect, style, options)
  } else {
    along(context, text, rect, style, options)
  }

  context.textAlign = 'left'
  context.restore()
}

/**
 * Where the pen starts across the cell.
 *
 * Numbers right, text left, unless the file says otherwise: the oldest
 * convention in spreadsheets, and what makes a column of figures readable —
 * the digits line up under each other.
 */
function acrossOf(
  text: string,
  rect: Rectangle,
  style: CellStyle | null,
  gutter: number,
): { align: 'left' | 'center' | 'right'; x: number } {
  const align = style?.align ?? defaultAlign(text)
  const indent = (style?.indent ?? 0) * INDENT

  const x =
    align === 'right'
      ? rect.x + rect.width - PADDING - indent
      : align === 'center'
        ? rect.x + gutter + (rect.width - gutter) / 2
        : rect.x + PADDING + indent + gutter

  return { align, x }
}

const downOf = (rect: Rectangle, style: CellStyle | null): number =>
  style?.verticalAlign === 'top'
    ? rect.y + rect.height / 4
    : style?.verticalAlign === 'bottom'
      ? rect.y + (rect.height * 3) / 4
      : rect.y + rect.height / 2

const canvasAlign = (align: 'left' | 'center' | 'right'): CanvasTextAlign =>
  align === 'right' ? 'right' : align === 'center' ? 'center' : 'left'

function along(
  context: CanvasRenderingContext2D,
  text: string,
  rect: Rectangle,
  style: CellStyle | null,
  options: TextOptions,
): void {
  const { align, x } = acrossOf(text, rect, style, options.gutter)

  context.textAlign = canvasAlign(align)
  context.fillText(text, x, downOf(rect, style))
}

/**
 * The same value over several lines.
 *
 * The lines are as many as the words need and the cell is as tall as the file
 * says; nothing here makes the row grow. Excel writes the height it worked out
 * into the row when wrapping is on, so a file that wraps arrives with the room
 * for it — and a row that turns out too short clips, which is what Excel shows
 * for a row somebody has since made shorter.
 */
function wrapped(
  context: CanvasRenderingContext2D,
  text: string,
  rect: Rectangle,
  style: CellStyle | null,
  options: TextOptions,
): void {
  const indent = (style?.indent ?? 0) * INDENT
  const room = rect.width - PADDING * 2 - indent - options.gutter
  const lines = wrapText(context, text, room)

  const step = lineHeightOf(context.font)
  const block = step * lines.length
  const middle = downOf(rect, style)
  // Centred on the same line a single value would have sat on, so one wrapped
  // cell in a row does not sit lower than its neighbours.
  const first = middle - block / 2 + step / 2

  for (const [index, line] of lines.entries()) {
    const { align, x } = acrossOf(line, rect, style, options.gutter)
    context.textAlign = canvasAlign(align)
    context.fillText(line, x, first + index * step)
  }
}

/**
 * A value turned on its side, or stood on end.
 *
 * Turned about the middle of the cell. Excel anchors rotated text to the
 * corner the angle leans away from, which matters when a cell is much wider
 * than its text; the middle is where the difference is smallest and is the
 * one choice that looks deliberate at every angle.
 */
function turned(
  context: CanvasRenderingContext2D,
  text: string,
  rect: Rectangle,
  style: CellStyle | null,
): void {
  const middle = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }

  context.save()
  context.translate(middle.x, middle.y)
  context.textAlign = 'center'

  if (style?.rotation === 'stacked') {
    // Letters one under another, each the right way up: what Excel means by a
    // rotation of 255, and not the same as turning the words ninety degrees.
    const step = lineHeightOf(context.font)
    const letters = lettersOf(text)
    const first = -(step * (letters.length - 1)) / 2

    for (const [index, letter] of letters.entries()) {
      context.fillText(letter, 0, first + index * step)
    }
  } else {
    // Anticlockwise in the file, which is clockwise on a canvas: the y axis
    // points down here and up in everybody's idea of an angle.
    context.rotate((-(style?.rotation ?? 0) * Math.PI) / 180)
    context.fillText(text, 0, 0)
  }

  context.restore()
}

/**
 * The height of one line, from the size the font states.
 *
 * A canvas will not tell you this — `measureText` answers about width — so it
 * is taken from the font shorthand and given the usual fifth again for the
 * space between lines.
 */
export function lineHeightOf(font: string): number {
  const size = /(\d*\.?\d+)px/u.exec(font)
  return Math.round((Number(size?.[1] ?? 12) || 12) * 1.2)
}

/**
 * A value broken into lines that fit a width.
 *
 * Broken at spaces, and inside a word only when the word alone is wider than
 * the cell — a long URL in a narrow column has to break somewhere, and the
 * alternative is one line running out of the cell.
 */
export function wrapText(context: CanvasRenderingContext2D, text: string, width: number): string[] {
  if (width <= 0) return [text]

  const lines: string[] = []

  for (const paragraph of text.split('\n')) {
    let line = ''

    for (const word of paragraph.split(' ')) {
      const candidate = line === '' ? word : `${line} ${word}`
      if (context.measureText(candidate).width <= width || line === '') {
        line = candidate
        continue
      }

      lines.push(line)
      line = word
    }

    lines.push(line)
  }

  return lines.flatMap((line) => broken(context, line, width))
}

/** One line cut where it must be, for a word with nowhere else to break. */
function broken(context: CanvasRenderingContext2D, line: string, width: number): string[] {
  if (context.measureText(line).width <= width) return [line]

  const pieces: string[] = []
  let piece = ''

  for (const letter of lettersOf(line)) {
    const candidate = piece + letter
    if (context.measureText(candidate).width > width && piece !== '') {
      pieces.push(piece)
      piece = letter
      continue
    }

    piece = candidate
  }

  if (piece !== '') pieces.push(piece)
  return pieces
}

/**
 * A value whose pieces do not all look alike.
 *
 * Laid out rather than written: each piece is measured in its own font, the
 * pieces are packed into lines, and every line is placed by the same
 * alignment rules a plain value follows. Without wrapping there is one line,
 * however long it is — the clip is what stops it.
 */
function inPieces(
  context: CanvasRenderingContext2D,
  runs: readonly StyledRun[],
  rect: Rectangle,
  style: CellStyle | null,
  options: TextOptions,
): void {
  const base = style?.font ?? options.font
  const indent = (style?.indent ?? 0) * INDENT
  const room = rect.width - PADDING * 2 - indent - options.gutter

  const lines =
    style?.wrap === true ? flowed(context, runs, room, base) : [[...runs].filter(notEmpty)]

  const step = lineHeightOf(base)
  const middle = downOf(rect, style)
  const first = middle - (step * lines.length) / 2 + step / 2

  // Drawn from the left of each line, so the pieces join up; where the line
  // sits is decided by measuring it whole.
  context.textAlign = 'left'

  for (const [index, line] of lines.entries()) {
    const width = line.reduce((total, run) => total + widthOf(context, run, base), 0)
    const { align } = acrossOf(line.map((run) => run.text).join(''), rect, style, options.gutter)

    let x =
      align === 'right'
        ? rect.x + rect.width - PADDING - indent - width
        : align === 'center'
          ? rect.x + options.gutter + (rect.width - options.gutter - width) / 2
          : rect.x + PADDING + indent + options.gutter

    for (const run of line) {
      context.font = run.font ?? base
      context.fillStyle = run.color ?? style?.color ?? options.color
      context.fillText(run.text, x, first + index * step)
      x += context.measureText(run.text).width
    }
  }
}

const notEmpty = (run: StyledRun): boolean => run.text !== ''

function widthOf(context: CanvasRenderingContext2D, run: StyledRun, base: string): number {
  context.font = run.font ?? base
  return context.measureText(run.text).width
}

/**
 * The pieces packed into lines that fit a width.
 *
 * Broken at spaces, wherever the space happens to fall — a word can start in
 * one piece and finish in the next, because whoever made half of it bold was
 * not thinking about where the lines would go.
 */
function flowed(
  context: CanvasRenderingContext2D,
  runs: readonly StyledRun[],
  width: number,
  base: string,
): StyledRun[][] {
  const lines: StyledRun[][] = []
  let line: StyledRun[] = []
  let used = 0

  const wrap = () => {
    lines.push(line)
    line = []
    used = 0
  }

  for (const run of runs) {
    // The separators are kept, so "a b" does not come back as "ab" on a line
    // that had room for both.
    for (const piece of run.text.split(/(\s+)/u).filter((one) => one !== '')) {
      const size = widthOf(context, { ...run, text: piece }, base)

      if (used + size > width && used > 0 && piece.trim() !== '') wrap()
      line.push({ ...run, text: piece })
      used += size
    }
  }

  if (line.length > 0) lines.push(line)
  return lines.length === 0 ? [[]] : lines
}
