import { useState } from 'react'
import {
  moveSlides,
  readSections,
  renameSection,
  slidesOfSection,
} from '@orangery/ooxml-presentation'
import type { Section, Slide } from '@orangery/ooxml-presentation'
import { SlideView } from '../render/slide-view'
import { useOnScreen } from '../render/use-on-screen'
import { useDeckStore } from '../store/deck-store'
import type { OpenDeck } from '../store/deck-store'
import { useViewStore } from '../store/view-store'
import { hasMod } from '@orangery/platform'

/**
 * The slides down the left, under the sections they fall in.
 *
 * Each thumbnail is the same renderer at a smaller size rather than a separate
 * drawing path — one way to draw a slide means a thumbnail cannot disagree with
 * the canvas.
 *
 * Only the ones near the window are drawn. Three hundred slides is three
 * hundred of that renderer, and the measurement said so plainly: six and a half
 * thousand elements before anybody has scrolled. Caching them as bitmaps was
 * the plan, and it would have made the second drawing cheap; not drawing the
 * two hundred and eighty nobody is looking at makes the first one cheap too.
 *
 * Slides are reordered by dragging. The dragged index is held here rather than
 * in the drag's data transfer: what is being dragged is a slide of the open
 * deck, not something another window could usefully receive, and reading the
 * transfer back on `dragover` is not allowed anyway — which is exactly where
 * the line showing the drop has to be decided.
 */
/**
 * One slide, drawn when it comes near the window.
 *
 * The placeholder keeps the slide's own proportions, so the strip is the right
 * length from the start and scrolling does not jump as thumbnails arrive.
 */
function Thumbnail({ open, slide }: { open: OpenDeck; slide: Slide }) {
  const { ref, shown } = useOnScreen()
  const size = open.deck.slideSize

  return (
    <div
      ref={ref}
      className="min-w-0 flex-1 border border-border"
      style={{ aspectRatio: `${String(size.width)} / ${String(size.height)}` }}
    >
      {shown && (
        <SlideView
          deck={open.deck}
          slide={slide}
          themes={open.themes}
          package={open.package}
          style={{ width: '100%' }}
        />
      )}
    </div>
  )
}

export function Filmstrip() {
  const open = useDeckStore((state) => state.open)
  const current = useDeckStore((state) => state.current)
  const picked = useDeckStore((state) => state.slideSelection)
  const select = useDeckStore((state) => state.select)
  const selectSlides = useDeckStore((state) => state.selectSlides)
  const editPackage = useDeckStore((state) => state.editPackage)

  const collapsed = useViewStore((state) => state.collapsedSections)
  const toggleSection = useViewStore((state) => state.toggleSection)
  const renaming = useViewStore((state) => state.renamingSection)
  const setRenaming = useViewStore((state) => state.setRenamingSection)

  const [dragging, setDragging] = useState<number | null>(null)
  const [over, setOver] = useState<number | null>(null)

  if (open === null) {
    return <p className="p-2 text-xs text-muted">No presentation open</p>
  }

  const total = open.deck.slides.length
  const sections = readSections(open.package)

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

    // The platform's own modifier, not either of them: on macOS a Ctrl-click is
    // the secondary click, so accepting it here made one gesture open a context
    // menu and change the selection at the same time.
    if (hasMod(event)) {
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

  const rename = (id: string, name: string) => {
    setRenaming(null)
    const trimmed = name.trim()
    if (trimmed === '') return

    editPackage((deck) => renameSection(deck.package, id, trimmed))
  }

  const thumbnail = (index: number) => {
    const slide = open.deck.slides[index]
    if (slide === undefined) return null

    return (
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
          <Thumbnail open={open} slide={slide} />
        </button>
        {line(index) === 'after' && <div data-testid="drop-line" className="h-0.5 bg-accent" />}
      </li>
    )
  }

  const header = (section: Section, at: number) => {
    const slides = slidesOfSection(sections, at, total)
    const folded = collapsed.includes(section.id)

    return (
      <li key={section.id} className="flex items-center gap-1 pt-1 text-xs">
        <button
          type="button"
          aria-label={`${folded ? 'Expand' : 'Collapse'} section ${section.name}`}
          aria-expanded={!folded}
          onClick={() => {
            toggleSection(section.id)
          }}
          className="w-4 shrink-0 text-muted"
        >
          {folded ? '▸' : '▾'}
        </button>

        {renaming === section.id ? (
          <input
            aria-label="Section name"
            defaultValue={section.name}
            autoFocus
            onBlur={(event) => {
              rename(section.id, event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') rename(section.id, event.currentTarget.value)
              if (event.key === 'Escape') setRenaming(null)
            }}
            className="min-w-0 flex-1 rounded border border-border bg-surface px-1 text-text"
          />
        ) : (
          <button
            type="button"
            aria-label={`Section ${section.name}`}
            onClick={() => {
              if (slides.length > 0) selectSlides(slides)
            }}
            onDoubleClick={() => {
              setRenaming(section.id)
            }}
            className="min-w-0 flex-1 truncate text-left font-medium text-text"
          >
            {section.name} <span className="font-normal text-muted">({String(slides.length)})</span>
          </button>
        )}
      </li>
    )
  }

  const rows =
    sections.length === 0
      ? open.deck.slides.map((_, index) => thumbnail(index))
      : sections.flatMap((section, at) => [
          header(section, at),
          ...(collapsed.includes(section.id)
            ? []
            : slidesOfSection(sections, at, total).map((index) => thumbnail(index))),
        ])

  return <ol className="flex flex-col gap-2 p-2">{rows}</ol>
}
