import { useRef, useState } from 'react'
import { addGuide, moveGuide, readGuides, removeGuide } from '@orangery/ooxml-presentation'
import type { SlideGuide } from '@orangery/ooxml-presentation'
import { EMU_PER_POINT } from '@orangery/ooxml-drawingml'
import { useDeckStore } from '../store/deck-store'

/**
 * Rulers down two sides of the slide, and the guides dragged out of them.
 *
 * A guide belongs to the window rather than to the deck: nothing on a slide
 * lines up with it once the file is closed, and PowerPoint keeps them in
 * `viewProps.xml` beside the zoom for the same reason. They are still written
 * to the file, because a guide you have to place again every morning is not
 * doing its job.
 *
 * Positions are a fraction of the slide rather than pixels, so a guide stays
 * where it was put at any zoom and the window can be resized under it.
 */

/** Marks every inch, which is what a ruler is read in wherever it is shown. */
const TICK = EMU_PER_POINT * 72

interface Dragging {
  orientation: 'horz' | 'vert'
  /** Where it is now, in EMU. */
  at: number
  /** Null while dragging a new one out of the ruler. */
  index: number | null
}

/** Marks every inch along one side; a ruler is read in inches wherever it is shown. */
function Ruler({
  orientation,
  along,
  onStart,
}: {
  orientation: 'horz' | 'vert'
  along: number
  onStart: (orientation: 'horz' | 'vert', event: React.PointerEvent) => void
}) {
  const ticks = Array.from({ length: Math.floor(along / TICK) + 1 }, (_, index) => index * TICK)

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={orientation === 'horz' ? 'Vertical ruler' : 'Horizontal ruler'}
      onPointerDown={(event) => {
        onStart(orientation, event)
      }}
      className={`absolute bg-surface ${
        orientation === 'horz'
          ? '-left-4 top-0 h-full w-4 cursor-col-resize'
          : '-top-4 left-0 h-4 w-full cursor-row-resize'
      }`}
    >
      {ticks.map((tick) => (
        <span
          key={tick}
          className="absolute bg-border"
          style={
            orientation === 'horz'
              ? { top: `${String((tick / along) * 100)}%`, right: 0, width: 6, height: 1 }
              : { left: `${String((tick / along) * 100)}%`, bottom: 0, width: 1, height: 6 }
          }
        />
      ))}
    </div>
  )
}

function GuideLine({
  guide,
  along,
  moving,
  onStart,
}: {
  guide: SlideGuide
  along: number
  moving: boolean
  onStart?: () => void
}) {
  const fraction = `${String((guide.at / along) * 100)}%`

  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label={`${guide.orientation === 'horz' ? 'Horizontal' : 'Vertical'} guide`}
      onPointerDown={(event) => {
        event.stopPropagation()
        onStart?.()
      }}
      style={
        guide.orientation === 'horz'
          ? { top: fraction, left: 0, right: 0, height: 1 }
          : { left: fraction, top: 0, bottom: 0, width: 1 }
      }
      className={`absolute ${moving ? 'bg-accent' : 'bg-muted'} ${
        guide.orientation === 'horz' ? 'cursor-row-resize' : 'cursor-col-resize'
      }`}
    />
  )
}

export function Guides({ width, height }: { width: number; height: number }) {
  const open = useDeckStore((state) => state.open)
  const editPackage = useDeckStore((state) => state.editPackage)

  const frame = useRef<HTMLDivElement>(null)
  const [dragging, setDragging] = useState<Dragging | null>(null)

  const guides: SlideGuide[] = open === null ? [] : readGuides(open.package)

  /** Where the pointer is on the slide, in EMU, or null when it is off it. */
  const positionOf = (
    event: { clientX: number; clientY: number },
    orientation: 'horz' | 'vert',
  ) => {
    const box = frame.current?.getBoundingClientRect()
    if (box === undefined || box.width === 0 || box.height === 0) return null

    return orientation === 'horz'
      ? ((event.clientY - box.top) / box.height) * height
      : ((event.clientX - box.left) / box.width) * width
  }

  /** A guide dropped off the slide is a guide thrown away, as everywhere else. */
  const outside = (at: number, orientation: 'horz' | 'vert') =>
    at < 0 || at > (orientation === 'horz' ? height : width)

  const track = (start: Dragging) => {
    setDragging(start)

    const move = (event: PointerEvent) => {
      const at = positionOf(event, start.orientation)
      if (at !== null) setDragging({ ...start, at })
    }

    const up = (event: PointerEvent) => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)

      const at = positionOf(event, start.orientation) ?? start.at
      setDragging(null)

      editPackage((deck) => {
        if (start.index === null) {
          return outside(at, start.orientation)
            ? false
            : addGuide(deck.package, { orientation: start.orientation, at })
        }
        return outside(at, start.orientation)
          ? removeGuide(deck.package, start.index)
          : moveGuide(deck.package, start.index, at)
      })
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  /** Dragging out of a ruler makes a guide that does not exist yet. */
  const startNew = (orientation: 'horz' | 'vert', event: React.PointerEvent) => {
    track({ orientation, at: positionOf(event, orientation) ?? 0, index: null })
  }

  return (
    <div ref={frame} data-testid="guide-layer" className="pointer-events-none absolute inset-0">
      <div className="pointer-events-auto">
        <Ruler orientation="horz" along={height} onStart={startNew} />
        <Ruler orientation="vert" along={width} onStart={startNew} />
        {guides.map((guide, index) => (
          <GuideLine
            key={`${guide.orientation}-${String(index)}`}
            guide={guide}
            along={guide.orientation === 'horz' ? height : width}
            moving={dragging?.index === index && dragging.orientation === guide.orientation}
            onStart={() => {
              track({ orientation: guide.orientation, at: guide.at, index })
            }}
          />
        ))}
        {dragging?.index === null && (
          <GuideLine
            guide={{ orientation: dragging.orientation, at: dragging.at }}
            along={dragging.orientation === 'horz' ? height : width}
            moving
          />
        )}
      </div>
    </div>
  )
}
