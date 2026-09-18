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

export type Handle = 'nw' | 'ne' | 'sw' | 'se'

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
}

interface Origin {
  x: number
  y: number
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
      return {
        dx: (event.clientX - from.x) * from.scale,
        dy: (event.clientY - from.y) * from.scale,
        handle: from.handle,
        shift: event.shiftKey,
        alt: event.altKey,
        scale: from.scale,
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
      origin.current = {
        x: event.clientX,
        y: event.clientY,
        scale: slideWidth / box.width,
        handle,
      }
      setState({
        dx: 0,
        dy: 0,
        handle,
        shift: event.shiftKey,
        alt: event.altKey,
        scale: slideWidth / box.width,
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

  const west = drag.handle === 'nw' || drag.handle === 'sw'
  const north = drag.handle === 'nw' || drag.handle === 'ne'

  // Alt resizes about the centre, so the opposite edge moves the other way.
  const factor = drag.alt ? 2 : 1
  let width = transform.width + (west ? -drag.dx : drag.dx) * factor
  let height = transform.height + (north ? -drag.dy : drag.dy) * factor

  if (drag.shift && transform.width !== 0 && transform.height !== 0) {
    // Keeps the aspect ratio, following whichever axis was dragged further.
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
