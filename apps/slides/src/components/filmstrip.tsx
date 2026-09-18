import { useState } from 'react'
import { moveSlides } from '@orangery/ooxml-presentation'
import { SlideView } from '../render/slide-view'
import { useDeckStore } from '../store/deck-store'

/**
 * The slides down the left.
 *
 * Each thumbnail is the same renderer at a smaller size rather than a separate
 * drawing path — one way to draw a slide means a thumbnail cannot disagree with
 * the canvas. Rendering them to bitmaps and caching is the phase-4 performance
 * task; at ten slides this is not yet worth the machinery.
 *
 * Slides are reordered by dragging. The dragged index is held here rather than
 * in the drag's data transfer: what is being dragged is a slide of the open
 * deck, not something another window could usefully receive, and reading the
 * transfer back on `dragover` is not allowed anyway — which is exactly where
 * the line showing the drop has to be decided.
 */
export function Filmstrip() {
  const open = useDeckStore((state) => state.open)
  const current = useDeckStore((state) => state.current)
  const picked = useDeckStore((state) => state.slideSelection)
  const select = useDeckStore((state) => state.select)
  const selectSlides = useDeckStore((state) => state.selectSlides)
  const editPackage = useDeckStore((state) => state.editPackage)

  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  if (open === null) {
    return <p className="p-2 text-xs text-muted">No presentation open</p>
  }

  /**
   * What a click means, by the modifier held.
   *
   * Shift takes the run from the slide being shown to the one clicked, which is
   * how a person picks a section; the platform modifier adds or removes one at
   * a time. Clicking a slide that is already among several picks only it, so
   * there is always a way back to one without reaching for a modifier.
   */
  const click = (
    index: number,
    event: { shiftKey: boolean; metaKey: boolean; ctrlKey: boolean },
  ) => {
    if (event.shiftKey && current >= 0) {
      const [from, to] = current < index ? [current, index] : [index, current]
      selectSlides(Array.from({ length: to - from + 1 }, (_, offset) => from + offset))
      return
    }

    if (event.metaKey || event.ctrlKey) {
      const without = picked.filter((one) => one !== index)
      selectSlides(without.length === picked.length ? [...picked, index] : without)
      return
    }

    select(index)
  }

  /** The slides a drag carries: the whole selection when it started inside one. */
  const carried = (index: number) => (picked.includes(index) ? picked : [index])

  const drop = (to: number) => {
    const from = dragging
    setDragging(null)
    setOver(null)
    if (from === null) return

    const moving = carried(from)
    const landed: { index: number | null } = { index: null }
    editPackage((deck) => {
      const result = moveSlides(deck.package, moving, to)
      landed.index = result?.index ?? null
      return result !== null
    })

    if (landed.index !== null) {
      selectSlides(moving.map((_, offset) => (landed.index ?? 0) + offset))
    }
  }

  /**
   * Which side of the slide under the cursor the block would land on, or null
   * when nothing would move.
   *
   * A line of its own rather than a coloured border: the thumbnail already
   * borders itself when it is the current slide, and two meanings on one edge
   * is one that cannot be read.
   */
  const line = (index: number): 'before' | 'after' | null => {
    if (dragging === null || over !== index) return null

    const moving = carried(dragging)
    const highest = moving.at(-1)
    if (highest === undefined || moving.includes(index)) return null
    return index > highest ? 'after' : 'before'
  }

  return (
    <ol className="flex flex-col gap-2 p-2">
      {open.deck.slides.map((slide, index) => (
        <li key={slide.path}>
          {line(index) === 'before' && <div data-testid="drop-line" className="h-0.5 bg-accent" />}
          <button
            type="button"
            draggable
            aria-label={`Slide ${String(index + 1)}`}
            aria-current={index === current}
            data-selected={picked.includes(index)}
            onClick={(event) => {
              click(index, event)
            }}
            onDragStart={() => {
              setDragging(index)
            }}
            onDragOver={(event) => {
              // Without this the drop never happens: the default is to refuse.
              event.preventDefault()
              setOver(index)
            }}
            onDrop={(event) => {
              event.preventDefault()
              drop(index)
            }}
            onDragEnd={() => {
              setDragging(null)
              setOver(null)
            }}
            className={`flex w-full items-start gap-2 rounded border p-1 text-left ${
              index === current
                ? 'border-accent'
                : picked.includes(index)
                  ? 'border-muted'
                  : 'border-transparent'
            } ${dragging !== null && carried(dragging).includes(index) ? 'opacity-50' : ''}`}
          >
            <span className="w-4 shrink-0 pt-1 text-[10px] text-muted">{index + 1}</span>
            <SlideView
              deck={open.deck}
              slide={slide}
              themes={open.themes}
              package={open.package}
              className="min-w-0 flex-1 border border-border"
            />
          </button>
          {line(index) === 'after' && <div data-testid="drop-line" className="h-0.5 bg-accent" />}
        </li>
      ))}
    </ol>
  )
}
