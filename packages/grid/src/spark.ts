import type { CellSpark } from './cell-style'

/**
 * A chart the size of a cell.
 *
 * Three kinds, and they are three answers to different questions. A line is
 * "how did this move"; columns are "how big was each of these"; a win-loss is
 * "which of these were good" — every bar the same height, up or down, which
 * is why it is the one people use for a column of results.
 *
 * Drawn from the numbers alone. Where they came from and what they mean is
 * the caller's; the grid is handed a list and a kind, as it is for a bar and
 * an icon.
 */

/**
 * A point's height in the cell, from 0 at the bottom to 1 at the top.
 *
 * A line is measured between its own smallest and largest number and a
 * column between nought and them. That is not an inconsistency: a line shows
 * how something moved, and a month that went from 98 to 102 is a line that
 * climbs; columns show how big each thing was, and four columns of nearly
 * the same height are the truth about them.
 */
function heights(
  points: readonly (number | null)[],
  winLoss: boolean,
  fromZero: boolean,
): (number | null)[] {
  const numbers = points.filter((one): one is number => one !== null)
  if (numbers.length === 0) return points.map(() => null)

  if (winLoss) {
    // Every bar the same size: what is being shown is the sign, not the
    // amount, and a win-loss that drew the amounts would be a column chart.
    return points.map((one) => (one === null ? null : one >= 0 ? 1 : -1))
  }

  const least = fromZero ? Math.min(...numbers, 0) : Math.min(...numbers)
  const most = fromZero ? Math.max(...numbers, 0) : Math.max(...numbers)
  const span = most - least

  // A run of identical numbers has no shape; drawn in the middle it at least
  // says that, where drawn at the bottom it would look like a run of noughts.
  if (span === 0) return points.map((one) => (one === null ? null : 0.5))

  return points.map((one) => (one === null ? null : (one - least) / span))
}

/** Where the axis sits in the cell, for the kinds that have one. */
function axisAt(points: readonly (number | null)[]): number {
  const numbers = points.filter((one): one is number => one !== null)
  const least = Math.min(...numbers, 0)
  const most = Math.max(...numbers, 0)
  const span = most - least

  return span === 0 ? 0.5 : (0 - least) / span
}

export function drawSpark(
  context: CanvasRenderingContext2D,
  spark: CellSpark,
  rect: { x: number; y: number; width: number; height: number },
): void {
  const points = spark.points
  if (points.length === 0) return

  // A margin, so that a line touching the top of its range is not drawn on
  // the border of the cell.
  const left = rect.x + 2
  const top = rect.y + 2
  const width = Math.max(0, rect.width - 4)
  const height = Math.max(0, rect.height - 4)
  if (width <= 0 || height <= 0) return

  const winLoss = spark.kind === 'winLoss'
  const tall = heights(points, winLoss, spark.kind !== 'line')

  context.save()

  if (spark.kind === 'line') {
    context.strokeStyle = spark.color
    context.lineWidth = 1
    context.beginPath()

    let started = false
    for (const [at, value] of tall.entries()) {
      if (value === null) {
        // A gap breaks the line rather than being drawn through: a line that
        // joined across a missing month would invent a month.
        started = false
        continue
      }

      const x = left + (points.length === 1 ? width / 2 : (width * at) / (points.length - 1))
      const y = top + height * (1 - value)

      if (started) context.lineTo(x, y)
      else context.moveTo(x, y)
      started = true
    }

    context.stroke()
    context.restore()
    return
  }

  const axis = winLoss ? 0.5 : axisAt(points)
  const each = width / points.length
  const bar = Math.max(1, each - 1)

  for (const [at, value] of tall.entries()) {
    if (value === null) continue

    const negative = winLoss ? value < 0 : (points[at] ?? 0) < 0
    context.fillStyle = negative ? (spark.negativeColor ?? spark.color) : spark.color

    const base = top + height * (1 - axis)
    const size = winLoss ? height * 0.4 : Math.abs(height * (value - axis))
    const y = negative ? base : base - size

    context.fillRect(left + each * at, y, bar, Math.max(1, size))
  }

  context.restore()
}
