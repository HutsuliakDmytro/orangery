import { useCallback, useEffect, useRef, useState } from 'react'
import type { Box } from './selection'
import { boxFrom } from './selection'

/**
 * The rubber band, in the slide's own units.
 *
 * Absolute rather than relative, which is why it is not `useDrag`: a drag
 * reports how far the pointer went and a band reports where it is, and folding
 * the second into the first would mean the band carried an origin no drag has a
 * use for.
 *
 * The scale is taken from the SVG when the band starts, for the same reason the
 * drag takes it then: the window can be resized between one and the next.
 */

interface Origin {
  /** Where it started, in slide units. */
  x: number
  y: number
  /** The SVG's rectangle on screen, to convert every move through. */
  left: number
  top: number
  scaleX: number
  scaleY: number
}

export function useMarquee({
  slideWidth,
  slideHeight,
  onPick,
}: {
  slideWidth: number
  slideHeight: number
  onPick: (box: Box) => void
}): { box: Box | null; start: (event: React.PointerEvent) => void } {
  const [box, setBox] = useState<Box | null>(null)
  const origin = useRef<Origin | null>(null)
  const latest = useRef<Box | null>(null)
  const pick = useRef(onPick)

  useEffect(() => {
    pick.current = onPick
  }, [onPick])

  useEffect(() => {
    function at(event: PointerEvent, from: Origin) {
      return {
        x: (event.clientX - from.left) * from.scaleX,
        y: (event.clientY - from.top) * from.scaleY,
      }
    }

    function onMove(event: PointerEvent) {
      const from = origin.current
      if (from === null) return

      const next = boxFrom({ x: from.x, y: from.y }, at(event, from))
      latest.current = next
      setBox(next)
    }

    function onUp() {
      const final = latest.current
      origin.current = null
      latest.current = null
      setBox(null)

      // A band of nothing is a click, and a click on the background has already
      // cleared the selection; picking again with an empty box would be a
      // second answer to the same gesture.
      if (final !== null && final.width > 0 && final.height > 0) pick.current(final)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [])

  const start = useCallback(
    (event: React.PointerEvent) => {
      const rect = event.currentTarget.closest('svg')?.getBoundingClientRect()
      if (rect === undefined || rect.width === 0 || rect.height === 0) return

      const scaleX = slideWidth / rect.width
      const scaleY = slideHeight / rect.height

      origin.current = {
        x: (event.clientX - rect.left) * scaleX,
        y: (event.clientY - rect.top) * scaleY,
        left: rect.left,
        top: rect.top,
        scaleX,
        scaleY,
      }
    },
    [slideWidth, slideHeight],
  )

  return { box, start }
}
