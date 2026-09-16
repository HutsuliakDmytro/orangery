import { useCurrentEditor } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useViewStore } from '../store/view-store'

/**
 * Horizontal ruler with draggable page margins and paragraph indents.
 *
 * Positions are in points throughout, matching the document model; only the
 * final placement multiplies by zoom. Dragging the margin markers changes the
 * section, dragging the indent markers changes the current paragraph.
 */

const POINTS_PER_INCH = 72

type Handle = 'left-margin' | 'right-margin' | 'first-line' | 'hanging'

export function Ruler() {
  const { editor } = useCurrentEditor()
  const zoom = useViewStore((state) => state.zoom)
  const section = useViewStore((state) => state.section)
  const setSection = useViewStore((state) => state.setSection)

  const [dragging, setDragging] = useState<Handle | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  const attributes = editor?.isActive('heading')
    ? editor.getAttributes('heading')
    : (editor?.getAttributes('paragraph') ?? {})
  const indentLeft = typeof attributes['indentLeft'] === 'number' ? attributes['indentLeft'] : 0
  const firstLine =
    typeof attributes['indentFirstLine'] === 'number' ? attributes['indentFirstLine'] : 0

  const pointsFromEvent = useCallback(
    (clientX: number): number => {
      const track = trackRef.current
      if (!track) return 0
      const bounds = track.getBoundingClientRect()
      // The track is rendered at the zoomed size, so undo the scale to get points.
      return Math.max(0, (clientX - bounds.left) / zoom / (96 / 72))
    },
    [zoom],
  )

  useEffect(() => {
    if (dragging === null) return

    const onMove = (event: PointerEvent) => {
      const points = pointsFromEvent(event.clientX)

      if (dragging === 'left-margin') {
        setSection({
          ...section,
          margins: { ...section.margins, left: Math.min(points, section.width / 2) },
        })
        return
      }

      if (dragging === 'right-margin') {
        setSection({
          ...section,
          margins: {
            ...section.margins,
            right: Math.min(Math.max(0, section.width - points), section.width / 2),
          },
        })
        return
      }

      if (!editor) return
      const relative = points - section.margins.left

      if (dragging === 'first-line') {
        editor
          .chain()
          .focus()
          .setIndent({ firstLine: relative - indentLeft })
          .run()
      } else {
        editor
          .chain()
          .focus()
          .setIndent({ left: Math.max(0, relative) })
          .run()
      }
    }

    const onUp = () => {
      setDragging(null)
    }

    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
    }
  }, [dragging, editor, indentLeft, pointsFromEvent, section, setSection])

  const toPixels = (points: number) => points * (96 / 72) * zoom
  const marks: number[] = []
  for (let inch = 0; inch * POINTS_PER_INCH <= section.width; inch += 0.5) marks.push(inch)

  const grab = (handle: Handle) => (event: React.PointerEvent) => {
    event.preventDefault()
    setDragging(handle)
  }

  return (
    <div className="flex justify-center border-b border-border bg-surface py-1">
      <div
        ref={trackRef}
        role="presentation"
        className="relative h-5"
        style={{ width: `${String(toPixels(section.width))}px` }}
      >
        {/* The text column, lighter than the margins around it. */}
        <div
          className="absolute inset-y-1 rounded-sm bg-surface-2"
          style={{
            left: `${String(toPixels(section.margins.left))}px`,
            right: `${String(toPixels(section.margins.right))}px`,
          }}
        />

        {marks.map((inch) => (
          <span
            key={inch}
            aria-hidden
            className={`absolute top-1/2 -translate-y-1/2 text-[9px] text-muted ${
              Number.isInteger(inch) ? '' : 'opacity-40'
            }`}
            style={{ left: `${String(toPixels(inch * POINTS_PER_INCH))}px` }}
          >
            {Number.isInteger(inch) && inch > 0 ? String(inch) : '·'}
          </span>
        ))}

        <RulerHandle
          label="Left margin"
          left={toPixels(section.margins.left)}
          onPointerDown={grab('left-margin')}
          shape="margin"
        />
        <RulerHandle
          label="Right margin"
          left={toPixels(section.width - section.margins.right)}
          onPointerDown={grab('right-margin')}
          shape="margin"
        />
        <RulerHandle
          label="First line indent"
          left={toPixels(section.margins.left + indentLeft + firstLine)}
          onPointerDown={grab('first-line')}
          shape="first-line"
        />
        <RulerHandle
          label="Left indent"
          left={toPixels(section.margins.left + indentLeft)}
          onPointerDown={grab('hanging')}
          shape="hanging"
        />
      </div>
    </div>
  )
}

function RulerHandle({
  label,
  left,
  onPointerDown,
  shape,
}: {
  label: string
  left: number
  onPointerDown: (event: React.PointerEvent) => void
  shape: 'margin' | 'first-line' | 'hanging'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onPointerDown={onPointerDown}
      className="absolute top-0 h-full w-3 -translate-x-1/2 cursor-ew-resize"
      style={{ left: `${String(left)}px` }}
    >
      <span
        aria-hidden
        className={
          shape === 'margin'
            ? 'absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-muted'
            : shape === 'first-line'
              ? 'absolute left-1/2 top-0 h-0 w-0 -translate-x-1/2 border-x-4 border-t-4 border-x-transparent border-t-accent'
              : 'absolute bottom-0 left-1/2 h-0 w-0 -translate-x-1/2 border-x-4 border-b-4 border-x-transparent border-b-accent'
        }
      />
    </button>
  )
}
