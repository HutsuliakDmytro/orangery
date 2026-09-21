import type { CellIcon } from './cell-style'

/**
 * The small shapes a cell can wear.
 *
 * Drawn rather than lettered. A font would be one line of code and a promise
 * nobody can keep: the glyphs that look like Excel's arrows are in fonts that
 * are not on every machine, and the ones that are everywhere — the emoji —
 * come out in somebody else's colours and somebody else's size. A path is the
 * same eleven pixels on every platform.
 *
 * Eleven pixels is also why these are shapes and not drawings. At that size a
 * flag is a triangle on a stick and an arrow is a stem and a head; anything
 * more careful turns to mud.
 */

/** The side of the square an icon is drawn in, in points. */
export const ICON_SIZE = 11

/** The room an icon takes from the text beside it. */
export const ICON_GUTTER = ICON_SIZE + 5

/** Where a shape's centre goes, and how big it is. */
interface Box {
  x: number
  y: number
  size: number
}

const ANGLES: Record<NonNullable<CellIcon['direction']>, number> = {
  right: 0,
  upRight: -Math.PI / 4,
  up: -Math.PI / 2,
  downRight: Math.PI / 4,
  down: Math.PI / 2,
}

/** The colour an unearned segment of a rating is drawn in. */
const SPENT = '#D4D4D4'

/**
 * An icon, centred in the space left for it at the left of a cell.
 *
 * `x` is where that space begins and `y` is the middle of the cell, which is
 * what the caller already has in hand when it is placing the text. `zoom` is
 * the sheet's, because an icon that stayed eleven pixels on a sheet drawn at
 * double size would look like a speck beside the words.
 */
export function drawIcon(
  context: CanvasRenderingContext2D,
  icon: CellIcon,
  x: number,
  y: number,
  zoom = 1,
) {
  const size = ICON_SIZE * zoom
  const box: Box = { x: x + size / 2, y, size }

  context.save()
  context.fillStyle = icon.color
  context.strokeStyle = icon.color
  context.lineWidth = 2 * zoom

  switch (icon.shape) {
    case 'arrow':
      arrow(context, box, ANGLES[icon.direction ?? 'right'])
      break
    case 'triangle':
      triangle(context, box, icon.direction === 'down' ? 1 : -1)
      break
    case 'dash':
      context.fillRect(box.x - box.size / 2, box.y - 1.5, box.size, 3)
      break
    case 'circle':
      circle(context, box, box.size / 2)
      break
    case 'flag':
      flag(context, box)
      break
    case 'diamond':
      diamond(context, box)
      break
    case 'check':
      check(context, box)
      break
    case 'cross':
      cross(context, box)
      break
    case 'exclamation':
      exclamation(context, box)
      break
    case 'bars':
      bars(context, box, icon)
      break
    case 'boxes':
      boxes(context, box, icon)
      break
    case 'pie':
      pie(context, box, icon)
      break
    case 'star':
      star(context, box, icon)
      break
  }

  context.restore()
}

/**
 * A stem and a head, turned to point where it is asked.
 *
 * Built in a unit square and rotated by hand rather than with the canvas's own
 * transform: the transform would have to be undone, and a shape drawn from
 * five points is clearer about what it is than one drawn from a matrix.
 */
function arrow(context: CanvasRenderingContext2D, box: Box, angle: number): void {
  const half = box.size / 2
  const turn = (dx: number, dy: number): [number, number] => [
    box.x + (dx * Math.cos(angle) - dy * Math.sin(angle)) * half,
    box.y + (dx * Math.sin(angle) + dy * Math.cos(angle)) * half,
  ]

  const points = [
    turn(-1, -0.25),
    turn(0.1, -0.25),
    turn(0.1, -0.65),
    turn(1, 0),
    turn(0.1, 0.65),
    turn(0.1, 0.25),
    turn(-1, 0.25),
  ]

  polygon(context, points)
}

function triangle(context: CanvasRenderingContext2D, box: Box, direction: number): void {
  const half = box.size / 2
  polygon(context, [
    [box.x, box.y + direction * half],
    [box.x - half, box.y - direction * half],
    [box.x + half, box.y - direction * half],
  ])
}

function circle(context: CanvasRenderingContext2D, box: Box, radius: number): void {
  context.beginPath()
  context.arc(box.x, box.y, radius, 0, Math.PI * 2)
  context.fill()
}

function flag(context: CanvasRenderingContext2D, box: Box): void {
  const half = box.size / 2

  // The pole in the cell's own ink so the flag reads as a flag rather than a
  // blob: at eleven pixels the two shapes have to differ in more than outline.
  context.fillRect(box.x - half, box.y - half, 1.5, box.size)
  polygon(context, [
    [box.x - half + 1.5, box.y - half],
    [box.x + half, box.y - half + 2.5],
    [box.x - half + 1.5, box.y],
  ])
}

function diamond(context: CanvasRenderingContext2D, box: Box): void {
  const half = box.size / 2
  polygon(context, [
    [box.x, box.y - half],
    [box.x + half, box.y],
    [box.x, box.y + half],
    [box.x - half, box.y],
  ])
}

function check(context: CanvasRenderingContext2D, box: Box): void {
  const half = box.size / 2

  context.beginPath()
  context.moveTo(box.x - half, box.y)
  context.lineTo(box.x - half / 4, box.y + half * 0.7)
  context.lineTo(box.x + half, box.y - half * 0.7)
  context.stroke()
}

function cross(context: CanvasRenderingContext2D, box: Box): void {
  const half = box.size / 2.6

  context.beginPath()
  context.moveTo(box.x - half, box.y - half)
  context.lineTo(box.x + half, box.y + half)
  context.moveTo(box.x + half, box.y - half)
  context.lineTo(box.x - half, box.y + half)
  context.stroke()
}

function exclamation(context: CanvasRenderingContext2D, box: Box): void {
  const half = box.size / 2

  context.fillRect(box.x - 1, box.y - half, 2.5, box.size * 0.6)
  context.fillRect(box.x - 1, box.y + half * 0.5, 2.5, 2.5)
}

/** A rating: upright bars, the earned ones in colour and the rest spent. */
function bars(context: CanvasRenderingContext2D, box: Box, icon: CellIcon): void {
  const steps = Math.max(1, icon.steps ?? 4)
  const filled = icon.filled ?? 0
  const width = box.size / (steps * 1.6)
  const gap = width * 0.6

  for (let at = 0; at < steps; at += 1) {
    const height = (box.size * (at + 1.5)) / (steps + 0.5)
    context.fillStyle = at < filled ? icon.color : SPENT
    context.fillRect(
      box.x - box.size / 2 + at * (width + gap),
      box.y + box.size / 2 - height,
      width,
      height,
    )
  }
}

/** A row of small squares, filled from the left. */
function boxes(context: CanvasRenderingContext2D, box: Box, icon: CellIcon): void {
  const steps = Math.max(1, icon.steps ?? 4)
  const filled = icon.filled ?? 0
  const width = box.size / (steps * 1.4)
  const gap = width * 0.4

  for (let at = 0; at < steps; at += 1) {
    context.fillStyle = at < filled ? icon.color : SPENT
    context.fillRect(box.x - box.size / 2 + at * (width + gap), box.y - width / 2, width, width)
  }
}

/** A circle with a wedge of it filled, which is how Excel counts quarters. */
function pie(context: CanvasRenderingContext2D, box: Box, icon: CellIcon): void {
  const steps = Math.max(1, icon.steps ?? 4)
  const radius = box.size / 2
  const filled = Math.min(steps, Math.max(0, icon.filled ?? 0))

  context.fillStyle = SPENT
  circle(context, box, radius)
  if (filled === 0) return

  context.fillStyle = icon.color
  context.beginPath()
  context.moveTo(box.x, box.y)
  // From the top and clockwise, because that is where a quarter starts.
  context.arc(box.x, box.y, radius, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * filled) / steps)
  context.closePath()
  context.fill()
}

/** Stars, earned left to right. */
function star(context: CanvasRenderingContext2D, box: Box, icon: CellIcon): void {
  const steps = Math.max(1, icon.steps ?? 3)
  const filled = icon.filled ?? 0
  const radius = box.size / (steps * 1.3)

  for (let at = 0; at < steps; at += 1) {
    const centre = {
      x: box.x - box.size / 2 + radius + at * radius * 2.2,
      y: box.y,
      size: radius * 2,
    }

    context.fillStyle = at < filled ? icon.color : SPENT
    polygon(
      context,
      Array.from({ length: 10 }, (_, point) => {
        const reach = point % 2 === 0 ? radius : radius * 0.45
        const angle = -Math.PI / 2 + (point * Math.PI) / 5
        return [centre.x + Math.cos(angle) * reach, centre.y + Math.sin(angle) * reach] as [
          number,
          number,
        ]
      }),
    )
  }
}

function polygon(context: CanvasRenderingContext2D, points: [number, number][]): void {
  const [first, ...rest] = points
  if (first === undefined) return

  context.beginPath()
  context.moveTo(first[0], first[1])
  for (const [x, y] of rest) context.lineTo(x, y)
  context.closePath()
  context.fill()
}
