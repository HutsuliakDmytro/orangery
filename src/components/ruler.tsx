import { useCurrentEditor, useEditorState } from '@tiptap/react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useViewStore } from '../store/view-store'
import { tabStopsOf } from '../editor/extensions/tab-stops'
import type { TabAlignment, TabLeader, TabStop } from '../ooxml/tabs'
import { sectionAt } from '../editor/sections'
import { serializeSection } from '../ooxml/section'
import type { SectionProperties } from '../ooxml/section'

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
  const bodySection = useViewStore((state) => state.section)
  const setBodySection = useViewStore((state) => state.setSection)

  const [dragging, setDragging] = useState<Handle | null>(null)
  const trackRef = useRef<HTMLDivElement>(null)

  /**
   * The block properties the markers stand for.
   *
   * Subscribed to rather than read at render time: nothing else re-renders the
   * ruler when the cursor moves into a paragraph with different indents, or
   * when a tab stop is added to the one it is already in.
   */
  /**
   * The page setup where the cursor is.
   *
   * A document can hold several sections; the body holds only the last, so the
   * margins the ruler draws are the ones of the section being edited.
   */
  const current = useEditorState({
    editor: editor ?? null,
    selector: ({ editor: instance }) =>
      instance
        ? sectionAt(instance.state.doc, instance.state.selection.from, bodySection)
        : { from: 0, to: 0, breakPosition: null, properties: bodySection },
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  }) ?? { from: 0, to: 0, breakPosition: null, properties: bodySection }

  const section = current.properties

  /** Writes the setup back where the section keeps it. */
  const breakPosition = current.breakPosition
  const setSection = useCallback(
    (next: SectionProperties) => {
      if (!editor || breakPosition === null) {
        setBodySection(next)
        return
      }

      const node = editor.state.doc.nodeAt(breakPosition)
      if (!node) return

      editor.view.dispatch(
        editor.state.tr.setNodeMarkup(breakPosition, undefined, {
          ...node.attrs,
          sectPr: serializeSection(next),
        }),
      )
    },
    [editor, breakPosition, setBodySection],
  )

  const attributes =
    useEditorState({
      editor: editor ?? null,
      selector: ({ editor: instance }) => {
        if (!instance) return {}
        return instance.isActive('heading')
          ? instance.getAttributes('heading')
          : instance.getAttributes('paragraph')
      },
      equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    }) ?? {}
  const indentLeft = typeof attributes['indentLeft'] === 'number' ? attributes['indentLeft'] : 0
  const stops = tabStopsOf(attributes)
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

  /**
   * Clicking the empty track adds a stop where the click landed.
   *
   * Word's ruler works this way, and the alternative — a dialog to type a
   * position into — makes the ruler decorative.
   */
  const addStop = (event: React.MouseEvent) => {
    // Anything but a handle: the ticks and the column background sit over the
    // track, so the click rarely lands on the track element itself.
    const onHandle = event.target instanceof HTMLElement && event.target.closest('button') !== null
    if (!editor || onHandle) return

    const position = Math.round(pointsFromEvent(event.clientX) - section.margins.left)
    if (position <= 0) return

    editor.chain().focus().setTabStop({ position, alignment: 'left', leader: 'none' }).run()
  }

  return (
    <div className="flex justify-center border-b border-border bg-surface py-1">
      <div
        ref={trackRef}
        role="presentation"
        className="relative h-5"
        style={{ width: `${String(toPixels(section.width))}px` }}
        onClick={addStop}
      >
        {/* The text column, lighter than the margins around it. */}
        <div
          className="absolute inset-y-1 rounded-sm bg-surface-2"
          style={{
            left: `${String(toPixels(section.margins.left))}px`,
            right: `${String(toPixels(section.margins.right))}px`,
          }}
        />

        {stops.map((stop) => (
          <TabStopHandle
            key={stop.position}
            stop={stop}
            left={toPixels(section.margins.left + stop.position)}
            onCycle={(leader) => {
              editor
                ?.chain()
                .focus()
                .setTabStop(leader ? withNextLeader(stop) : cycled(stop))
                .run()
            }}
            onRemove={() => {
              editor?.chain().focus().clearTabStop(stop.position).run()
            }}
          />
        ))}

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

/** The order a stop cycles through when its marker is clicked, as in Word. */
function cycled(stop: TabStop): TabStop {
  const order: TabAlignment[] = ['left', 'center', 'right', 'decimal']
  const next = order[(order.indexOf(stop.alignment) + 1) % order.length] ?? 'left'

  return { ...stop, alignment: next }
}

/** What fills the gap in front of the stop, cycled by holding Alt. */
function withNextLeader(stop: TabStop): TabStop {
  const order: TabLeader[] = ['none', 'dot', 'hyphen', 'underscore']
  const next = order[(order.indexOf(stop.leader) + 1) % order.length] ?? 'none'

  return { ...stop, leader: next }
}

const STOP_GLYPHS: Readonly<Record<string, string>> = {
  left: '\u2514',
  center: '\u2534',
  right: '\u2518',
  decimal: '\u253B',
  bar: '\u2502',
}

function TabStopHandle({
  stop,
  left,
  onCycle,
  onRemove,
}: {
  stop: TabStop
  left: number
  /** True when the leader is being cycled rather than the alignment. */
  onCycle: (leader: boolean) => void
  onRemove: () => void
}) {
  const description = `${stop.alignment} tab stop${stop.leader === 'none' ? '' : ` with ${stop.leader} leader`}`

  return (
    <button
      type="button"
      aria-label={description}
      title={`${description} — click to change alignment, Alt-click to change the leader, double-click to remove`}
      onClick={(event) => {
        // The track adds a stop where it is clicked; a click on a marker is
        // about that marker.
        event.stopPropagation()
        onCycle(event.altKey)
      }}
      onDoubleClick={(event) => {
        event.stopPropagation()
        onRemove()
      }}
      className="absolute bottom-0 h-3 w-3 -translate-x-1/2 text-[10px] leading-none text-accent"
      style={{ left: `${String(left)}px` }}
    >
      <span aria-hidden>{STOP_GLYPHS[stop.alignment] ?? '\u2514'}</span>
    </button>
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
