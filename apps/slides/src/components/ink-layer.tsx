import { useRef, useState } from 'react'
import type { ShowTool, Stroke } from '../store/show-store'
import { useShowStore } from '../store/show-store'

/**
 * Drawing on the slide while presenting.
 *
 * Over the slide and under nothing: the pen has to be able to mark anything the
 * room can see. Points are kept in the slide's own units rather than in pixels,
 * so ink drawn on a laptop is in the same place on the projector.
 *
 * The laser leaves nothing. It is a finger pointed at the screen, and a finger
 * that left a trail would be a pen.
 */

/** Where the pointer is on the slide, in its own units. */
function slidePoint(
  event: { clientX: number; clientY: number },
  box: DOMRect,
  size: { width: number; height: number },
) {
  if (box.width === 0 || box.height === 0) return null

  return {
    x: ((event.clientX - box.left) / box.width) * size.width,
    y: ((event.clientY - box.top) / box.height) * size.height,
  }
}

const pathOf = (stroke: Stroke): string =>
  stroke.points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${String(point.x)},${String(point.y)}`)
    .join(' ')

/** The cursor each tool wears, so the pointer says what a drag will do. */
const CURSORS: Readonly<Record<ShowTool, string>> = {
  none: 'default',
  pen: 'crosshair',
  highlighter: 'crosshair',
  eraser: 'pointer',
  laser: 'none',
}

export function InkLayer({ size }: { size: { width: number; height: number } }) {
  const tool = useShowStore((state) => state.tool)
  const at = useShowStore((state) => state.at)
  const ink = useShowStore((state) => state.ink)

  const frame = useRef<SVGSVGElement>(null)
  const [laser, setLaser] = useState<{ x: number; y: number } | null>(null)
  const drawing = useRef(false)

  if (at === null) return null
  const strokes = ink[at] ?? []

  // Ink stays when the pen is put down. What was drawn on the slide is on the
  // slide; only the ability to draw more goes away.
  if (tool === 'none' && strokes.length === 0) return null

  const pointOf = (event: { clientX: number; clientY: number }) => {
    const box = frame.current?.getBoundingClientRect()
    return box === undefined ? null : slidePoint(event, box, size)
  }

  return (
    <svg
      ref={frame}
      data-testid="ink"
      viewBox={`0 0 ${String(size.width)} ${String(size.height)}`}
      preserveAspectRatio="none"
      className="absolute inset-0 h-full w-full"
      style={{ cursor: CURSORS[tool], pointerEvents: tool === 'none' ? 'none' : 'auto' }}
      onPointerDown={(event) => {
        // The click belongs to the tool. Somebody drawing on a slide has not
        // asked for the next one.
        event.stopPropagation()
        const point = pointOf(event)
        if (point === null || tool === 'laser' || tool === 'eraser') return

        drawing.current = true
        event.currentTarget.setPointerCapture(event.pointerId)
        useShowStore.getState().beginStroke(point)
      }}
      onPointerMove={(event) => {
        const point = pointOf(event)
        if (point === null) return

        if (tool === 'laser') {
          setLaser(point)
          return
        }
        if (drawing.current) useShowStore.getState().extendStroke(point)
      }}
      onPointerUp={() => {
        drawing.current = false
      }}
      onPointerLeave={() => {
        drawing.current = false
        setLaser(null)
      }}
    >
      {strokes.map((stroke, index) => (
        <path
          key={index}
          d={pathOf(stroke)}
          fill="none"
          stroke={stroke.color}
          strokeOpacity={stroke.highlight ? 0.4 : 1}
          strokeWidth={stroke.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          // Thick enough to hit even where the line is thin: an eraser you have
          // to aim is an eraser nobody uses in front of a room.
          pointerEvents={tool === 'eraser' ? 'stroke' : 'none'}
          onPointerDown={(event) => {
            if (tool !== 'eraser') return
            event.stopPropagation()
            useShowStore.getState().eraseStroke(index)
          }}
        />
      ))}

      {tool === 'laser' && laser !== null && (
        <circle
          data-testid="laser"
          cx={laser.x}
          cy={laser.y}
          r={size.width / 90}
          fill="#FF3B30"
          fillOpacity={0.75}
        />
      )}
    </svg>
  )
}
