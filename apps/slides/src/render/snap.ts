/**
 * Snapping a dragged shape to what is already on the slide.
 *
 * Everything here is EMU and pure geometry: what the shape would be if the drag
 * ended now, what it lines up with, and where to draw the lines that say so.
 * The tolerance arrives in EMU too — the caller converts it from pixels,
 * because "close enough" is a distance on screen and not on the slide, and a
 * slide zoomed to a quarter would otherwise snap from four times as far away.
 *
 * A guide is drawn from the matched shape to the dragged one rather than across
 * the whole slide: the line is there to say which two things agree, and one
 * running edge to edge says it about everything at once.
 */

export interface Rect {
  x: number
  y: number
  width: number
  height: number
}

export interface Guide {
  axis: 'x' | 'y'
  /** Where the line sits on its axis, in EMU. */
  at: number
  /** How far along the other axis it runs. */
  from: number
  to: number
  /** An alignment of edges or centres, or two gaps that came out equal. */
  kind: 'align' | 'spacing'
}

export interface Snapped {
  rect: Rect
  guides: Guide[]
}

/** The three lines a rectangle offers on an axis: both edges and the middle. */
const linesOf = (rect: Rect, axis: 'x' | 'y'): number[] =>
  axis === 'x'
    ? [rect.x, rect.x + rect.width / 2, rect.x + rect.width]
    : [rect.y, rect.y + rect.height / 2, rect.y + rect.height]

const startOf = (rect: Rect, axis: 'x' | 'y') => (axis === 'x' ? rect.x : rect.y)
const sizeOf = (rect: Rect, axis: 'x' | 'y') => (axis === 'x' ? rect.width : rect.height)
const endOf = (rect: Rect, axis: 'x' | 'y') => startOf(rect, axis) + sizeOf(rect, axis)

/** Whether two rectangles overlap across the other axis, which is what makes them neighbours. */
function overlaps(one: Rect, other: Rect, axis: 'x' | 'y'): boolean {
  const across = axis === 'x' ? 'y' : 'x'
  return startOf(one, across) < endOf(other, across) && startOf(other, across) < endOf(one, across)
}

interface Match {
  /** How far the rectangle has to move on this axis. */
  offset: number
  guide: Guide
}

/** The closest alignment on one axis, or null when nothing is near enough. */
function alignment(
  rect: Rect,
  others: readonly Rect[],
  slide: Rect,
  axis: 'x' | 'y',
  tolerance: number,
  guides: readonly number[] = [],
): Match | null {
  const mine = linesOf(rect, axis)
  let best: Match | null = null

  // The slide's own edges and middle count as much as any shape's, and so does
  // a line somebody dragged out of the ruler — that is what it was dragged out
  // for, and a guide nothing snaps to is a decoration.
  const targets: { at: number; rect: Rect | null }[] = [
    ...linesOf(slide, axis).map((at) => ({ at, rect: null })),
    ...guides.map((at) => ({ at, rect: null })),
    ...others.flatMap((other) => linesOf(other, axis).map((at) => ({ at, rect: other }))),
  ]

  for (const target of targets) {
    for (const line of mine) {
      const offset = target.at - line
      if (Math.abs(offset) > tolerance) continue
      if (best !== null && Math.abs(offset) >= Math.abs(best.offset)) continue

      const across = axis === 'x' ? 'y' : 'x'
      const reach =
        target.rect === null
          ? [startOf(slide, across), endOf(slide, across)]
          : [
              Math.min(startOf(rect, across), startOf(target.rect, across)),
              Math.max(endOf(rect, across), endOf(target.rect, across)),
            ]

      best = {
        offset,
        guide: { axis, at: target.at, from: reach[0] ?? 0, to: reach[1] ?? 0, kind: 'align' },
      }
    }
  }

  return best
}

/**
 * The closest position that repeats a gap already on the slide.
 *
 * Only shapes that overlap the dragged one across the other axis are counted:
 * two boxes in a row are spaced evenly, a box and something off in the corner
 * are not, and calling that a match would snap to coincidences.
 */
function spacing(
  rect: Rect,
  others: readonly Rect[],
  axis: 'x' | 'y',
  tolerance: number,
): Match | null {
  const neighbours = others
    .filter((other) => overlaps(rect, other, axis))
    .sort((one, two) => startOf(one, axis) - startOf(two, axis))

  const gaps = neighbours
    .slice(1)
    .map((one, index) => startOf(one, axis) - endOf(neighbours[index] as Rect, axis))
    .filter((gap) => gap > 0)

  if (gaps.length === 0) return null

  const across = axis === 'x' ? 'y' : 'x'
  const middle = startOf(rect, across) + sizeOf(rect, across) / 2
  const size = sizeOf(rect, axis)

  let best: Match | null = null

  for (const gap of new Set(gaps)) {
    for (const neighbour of neighbours) {
      // Either side of it, the same distance away.
      const places = [
        {
          at: endOf(neighbour, axis) + gap,
          from: endOf(neighbour, axis),
          to: endOf(neighbour, axis) + gap,
        },
        {
          at: startOf(neighbour, axis) - gap - size,
          from: startOf(neighbour, axis) - gap,
          to: startOf(neighbour, axis),
        },
      ]

      for (const place of places) {
        const offset = place.at - startOf(rect, axis)
        if (Math.abs(offset) > tolerance) continue
        if (best !== null && Math.abs(offset) >= Math.abs(best.offset)) continue

        // The marker lies along the axis it measures, so it sits on the other
        // one — at the middle of the shape being dragged.
        best = {
          offset,
          guide: { axis: across, at: middle, from: place.from, to: place.to, kind: 'spacing' },
        }
      }
    }
  }

  return best
}

/**
 * Nudges a dragged rectangle onto whatever it is nearly lined up with.
 *
 * `resizing` says which way a match is honoured: a move slides the whole
 * rectangle, while a resize holds the far edge still and takes up the
 * difference in the size — the corner being dragged is the one that moves.
 */
export function snapRect({
  rect,
  others,
  slide,
  tolerance,
  resizing = false,
  lines = { x: [], y: [] },
  grid = null,
}: {
  rect: Rect
  others: readonly Rect[]
  slide: { width: number; height: number }
  tolerance: number
  resizing?: boolean
  /** The guides dragged out of the rulers, by the axis each one lies on. */
  lines?: { x: readonly number[]; y: readonly number[] }
  /**
   * How far apart the grid's lines are, or null when it is not being snapped to.
   *
   * Last of the three: a shape that lines up with another shape or with a guide
   * has found something meant, and pulling it a further half-millimetre onto
   * the grid would undo the alignment it just made.
   */
  grid?: number | null
}): Snapped {
  const bounds: Rect = { x: 0, y: 0, width: slide.width, height: slide.height }
  const guides: Guide[] = []
  const snapped = { ...rect }

  for (const axis of ['x', 'y'] as const) {
    const match =
      alignment(snapped, others, bounds, axis, tolerance, lines[axis]) ??
      (resizing ? null : spacing(snapped, others, axis, tolerance))

    if (match === null) {
      // The grid is drawn, so it needs no line to say what happened. It also
      // never refuses: unlike an alignment, there is always a nearest one.
      const onto = toGrid(snapped, axis, grid, resizing)
      if (onto !== 0) {
        if (axis === 'x') {
          if (resizing) snapped.width = Math.max(snapped.width + onto, 0)
          else snapped.x += onto
        } else if (resizing) snapped.height = Math.max(snapped.height + onto, 0)
        else snapped.y += onto
      }
      continue
    }

    guides.push(match.guide)

    // Which line matched decides what moves: an edge near the start takes the
    // offset on the position, one near the end takes it on the size.
    if (!resizing) {
      if (axis === 'x') snapped.x += match.offset
      else snapped.y += match.offset
      continue
    }

    const nearEnd =
      Math.abs(match.guide.at - endOf(snapped, axis)) <
      Math.abs(match.guide.at - startOf(snapped, axis))
    if (axis === 'x') {
      if (nearEnd) snapped.width = Math.max(snapped.width + match.offset, 0)
      else {
        snapped.x += match.offset
        snapped.width = Math.max(snapped.width - match.offset, 0)
      }
    } else if (nearEnd) snapped.height = Math.max(snapped.height + match.offset, 0)
    else {
      snapped.y += match.offset
      snapped.height = Math.max(snapped.height - match.offset, 0)
    }
  }

  return { rect: snapped, guides }
}

/**
 * How far a rectangle is from the nearest grid line on one axis.
 *
 * The leading edge when moving — the whole shape then sits on the grid — and
 * the trailing one when resizing, which is the edge the pointer has hold of.
 */
function toGrid(rect: Rect, axis: 'x' | 'y', grid: number | null, resizing: boolean): number {
  if (grid === null || grid <= 0) return 0

  const edge = resizing ? endOf(rect, axis) : startOf(rect, axis)
  return Math.round(edge / grid) * grid - edge
}

/** The rectangle around several, which is what a multiple selection drags as. */
export function boundsOf(rects: readonly Rect[]): Rect | null {
  const first = rects[0]
  if (first === undefined) return null

  let left = first.x
  let top = first.y
  let right = first.x + first.width
  let bottom = first.y + first.height

  for (const rect of rects.slice(1)) {
    left = Math.min(left, rect.x)
    top = Math.min(top, rect.y)
    right = Math.max(right, rect.x + rect.width)
    bottom = Math.max(bottom, rect.y + rect.height)
  }

  return { x: left, y: top, width: right - left, height: bottom - top }
}

/** What snapping added to a drag, as one thing that can be applied twice. */
export interface Correction {
  dx: number
  dy: number
  dw: number
  dh: number
}

export const NO_CORRECTION: Correction = { dx: 0, dy: 0, dw: 0, dh: 0 }

export function correctionBetween(applied: Rect, snapped: Rect): Correction {
  return {
    dx: snapped.x - applied.x,
    dy: snapped.y - applied.y,
    dw: snapped.width - applied.width,
    dh: snapped.height - applied.height,
  }
}

/**
 * Applies a correction to a rectangle.
 *
 * The same correction goes to what is drawn and to what is written, because a
 * shape that snapped on screen and did not snap in the file is the worst of
 * both: the guide said it lined up and it does not.
 */
export function correct(rect: Rect, correction: Correction): Rect {
  return {
    x: rect.x + correction.dx,
    y: rect.y + correction.dy,
    width: Math.max(rect.width + correction.dw, 0),
    height: Math.max(rect.height + correction.dh, 0),
  }
}
