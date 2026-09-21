import { useLayoutEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Transform } from '@orangery/ooxml-presentation'

/**
 * A shape drawn where it was, moving to where it is.
 *
 * The morph is the one transition that is not about the slide: it is about the
 * shapes on it, each going from its old place to its new one while the rest of
 * the slide stands still.
 *
 * Two renders, not one. The first puts the shape where it came from; the second
 * takes the transform away and lets the transition carry it. A single render
 * with the end state and a transition would animate from nothing, because there
 * is no previous value for the engine to move away from.
 */
export function MorphGroup({
  from,
  to,
  duration,
  children,
}: {
  /** Where the shape was on the slide being left. */
  from: Transform
  /** Where it is on the slide arriving. */
  to: Transform
  duration: number
  children: ReactNode
}) {
  const [placed, setPlaced] = useState(false)
  const frame = useRef<number | null>(null)

  useLayoutEffect(() => {
    // The next frame, not this one: the browser has to have drawn the shape in
    // its old place before there is anything to move it from.
    frame.current = requestAnimationFrame(() => {
      setPlaced(true)
    })

    return () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    }
  }, [])

  const scaleX = to.width === 0 ? 1 : from.width / to.width
  const scaleY = to.height === 0 ? 1 : from.height / to.height

  // A point p of the new shape has to land where the old one had it, which is
  // the scale about the origin plus whatever is left to make the corners meet.
  const shifted = `translate(${String(from.x - to.x * scaleX)} ${String(from.y - to.y * scaleY)}) scale(${String(scaleX)} ${String(scaleY)})`

  return (
    <g
      style={{
        transform: placed ? 'none' : shifted,
        transition: `transform ${String(duration)}ms ease-in-out`,
      }}
    >
      {children}
    </g>
  )
}
