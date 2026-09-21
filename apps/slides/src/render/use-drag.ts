import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Dragging on the slide, in the slide's own units.
 *
 * The pointer moves in pixels and the slide is measured in EMU, so a drag has
 * to be converted through however large the canvas happens to be drawn. The
 * scale is taken from the SVG's own rectangle when the drag starts: the window
 * can be resized between drags, and one captured at mount would be wrong after
 * the first resize.
 *
 * Listening on the window rather than the element: the pointer leaving the
 * shape mid-drag is the normal case, and a shape that moves out from under the
 * cursor would otherwise stop following it.
 *
 * The delta is reported while dragging and committed once on release, so a drag
 * across the slide is one undo step rather than a hundred.
 */

/**
 * The eight sizing handles and the one that turns the shape.
 *
 * Named by compass point, so which edges a handle moves is read off the name:
 * `nw` moves the top and the left, `n` moves only the top. `rotate` is not a
 * size at all and is kept out of that reading everywhere it would be wrong.
 */
export type SizingHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w'

/** Everything a pointer can take hold of: the eight sizes, the turn, the ends. */
export type Handle = SizingHandle | 'rotate' | 'cxn-start' | 'cxn-end'

export const SIZING_HANDLES: readonly SizingHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

export interface DragState {
  /** How far the pointer has moved, in EMU. */
  dx: number
  dy: number
  /** Which corner is being dragged, or null when the shape itself is. */
  handle: Handle | null
  /** Held while dragging: constrain. */
  shift: boolean
  /** Held while dragging: from the centre. */
  alt: boolean
  /**
   * EMU per pixel as the slide is drawn right now.
   *
   * Carried on the drag because "close enough to snap" is a distance on screen:
   * a slide zoomed to a quarter would otherwise snap from four times as far.
   */
  scale: number
  /**
   * Where the drag began and where it is now, in the slide's own coordinates.
   *
   * A move only needs the difference, which is why this was not here before.
   * Turning a shape needs the two positions themselves: the angle is measured
   * from the shape's centre to the pointer, and a difference has no centre.
   */
  from: { x: number; y: number }
  to: { x: number; y: number }
}

interface Origin {
  x: number
  y: number
  /** The SVG's rectangle on screen, to place the pointer on the slide. */
  left: number
  top: number
  scale: number
  handle: Handle | null
}

export function useDrag({
  slideWidth,
  onCommit,
}: {
  slideWidth: number
  onCommit: (state: DragState) => void
}): {
  state: DragState | null
  start: (event: React.PointerEvent, handle: Handle | null) => void
} {
  const [state, setState] = useState<DragState | null>(null)
  const origin = useRef<Origin | null>(null)
  const latest = useRef<DragState | null>(null)
  const commit = useRef(onCommit)

  // Assigned in an effect rather than during render: a ref touched while
  // rendering is a ref that can disagree with what was rendered.
  useEffect(() => {
    commit.current = onCommit
  }, [onCommit])

  useEffect(() => {
    function stateFrom(event: PointerEvent, from: Origin): DragState {
      const on = (clientX: number, clientY: number) => ({
        x: (clientX - from.left) * from.scale,
        y: (clientY - from.top) * from.scale,
      })

      return {
        dx: (event.clientX - from.x) * from.scale,
        dy: (event.clientY - from.y) * from.scale,
        handle: from.handle,
        shift: event.shiftKey,
        alt: event.altKey,
        scale: from.scale,
        from: on(from.x, from.y),
        to: on(event.clientX, event.clientY),
      }
    }

    function onMove(event: PointerEvent) {
      const from = origin.current
      if (from === null) return

      const next = stateFrom(event, from)
      latest.current = next
      setState(next)
    }

    function onUp(event: PointerEvent) {
      const from = origin.current
      if (from === null) return

      const final = stateFrom(event, from)
      origin.current = null
      latest.current = null
      setState(null)

      // A click is a drag of nothing; committing it would fill the history with
      // steps that changed the file by zero.
      if (final.dx !== 0 || final.dy !== 0) commit.current(final)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const start = useCallback(
    (event: React.PointerEvent, handle: Handle | null) => {
      const box = event.currentTarget.closest('svg')?.getBoundingClientRect()
      if (box === undefined || box.width === 0) return

      event.stopPropagation()
      const scale = slideWidth / box.width
      const at = {
        x: (event.clientX - box.left) * scale,
        y: (event.clientY - box.top) * scale,
      }

      origin.current = {
        x: event.clientX,
        y: event.clientY,
        left: box.left,
        top: box.top,
        scale,
        handle,
      }
      setState({
        dx: 0,
        dy: 0,
        handle,
        shift: event.shiftKey,
        alt: event.altKey,
        scale,
        from: at,
        to: at,
      })
    },
    [slideWidth],
  )

  return { state, start }
}

/** What a drag does to a transform, before it is written. */
export function applyDrag(
  transform: { x: number; y: number; width: number; height: number },
  drag: DragState,
): { x: number; y: number; width: number; height: number } {
  if (drag.handle === null) {
    // Shift constrains a move to one axis, which is what every editor does.
    const straight = drag.shift && Math.abs(drag.dx) > Math.abs(drag.dy)
    const sideways = drag.shift && !straight

    return {
      ...transform,
      x: transform.x + (sideways ? 0 : drag.dx),
      y: transform.y + (straight ? 0 : drag.dy),
    }
  }

  // Turning is not sizing, and neither is dragging the end of a connector:
  // both are applied somewhere other than to the rectangle.
  if (drag.handle === 'rotate' || drag.handle.startsWith('cxn-')) return transform

  const west = drag.handle.includes('w')
  const east = drag.handle.includes('e')
  const north = drag.handle.includes('n')
  const south = drag.handle.includes('s')

  // An edge handle moves one edge. Dragging the top of a box sideways must do
  // nothing at all, which is the whole difference between an edge and a corner.
  const horizontal = west || east
  const vertical = north || south

  // Alt resizes about the centre, so the opposite edge moves the other way.
  const factor = drag.alt ? 2 : 1
  let width = horizontal ? transform.width + (west ? -drag.dx : drag.dx) * factor : transform.width
  let height = vertical
    ? transform.height + (north ? -drag.dy : drag.dy) * factor
    : transform.height

  if (drag.shift && horizontal && vertical && transform.width !== 0 && transform.height !== 0) {
    // Keeps the aspect ratio, following whichever axis was dragged further.
    // Corners only: an edge has one axis, and "keep the proportions" while
    // dragging one edge would move the other, which is not what was grabbed.
    const ratio = transform.height / transform.width
    if (Math.abs(width - transform.width) > Math.abs(height - transform.height)) {
      height = width * ratio
    } else {
      width = height / ratio
    }
  }

  // A shape cannot be inside out; PowerPoint flips it, we stop at nothing.
  width = Math.max(width, 0)
  height = Math.max(height, 0)

  const dw = width - transform.width
  const dh = height - transform.height

  return {
    x: transform.x - (drag.alt ? dw / 2 : west ? dw : 0),
    y: transform.y - (drag.alt ? dh / 2 : north ? dh : 0),
    width,
    height,
  }
}

/** A whole turn, in the sixty-thousandths of a degree OOXML counts in. */
export const FULL_TURN = 360 * 60000

/** What Shift snaps a turn to: fifteen degrees, as PowerPoint does. */
const SNAP_TO = 15 * 60000

/**
 * The angle a rotate drag ends at, given where the shape started.
 *
 * Measured from the shape's centre to the pointer, before and after, and the
 * difference added to whatever the shape was already turned by. A difference
 * rather than an absolute angle because the handle is not where the pointer
 * grabbed it: taking the pointer's own angle would snap the shape round to meet
 * the cursor the instant the drag began.
 *
 * `box` must be the shape as it sits on the slide, because that is the space
 * the pointer was measured in.
 */
export function applyRotation(
  transform: { rotation: number },
  box: { x: number; y: number; width: number; height: number },
  drag: DragState,
): number {
  const centre = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  const angleOf = (point: { x: number; y: number }) =>
    Math.atan2(point.y - centre.y, point.x - centre.x)

  const turned = ((angleOf(drag.to) - angleOf(drag.from)) * 180) / Math.PI
  const raw = transform.rotation + turned * 60000

  const snapped = drag.shift ? Math.round(raw / SNAP_TO) * SNAP_TO : raw

  // Kept inside one turn: a shape turned round eleven times is turned once, and
  // the number in the file should say so.
  return ((snapped % FULL_TURN) + FULL_TURN) % FULL_TURN
}
