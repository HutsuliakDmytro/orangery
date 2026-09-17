import { SlideView } from '../render/slide-view'
import { useDeckStore } from '../store/deck-store'

/**
 * The slides down the left.
 *
 * Each thumbnail is the same renderer at a smaller size rather than a separate
 * drawing path — one way to draw a slide means a thumbnail cannot disagree with
 * the canvas. Rendering them to bitmaps and caching is the phase-4 performance
 * task; at ten slides this is not yet worth the machinery.
 */
export function Filmstrip() {
  const open = useDeckStore((state) => state.open)
  const current = useDeckStore((state) => state.current)
  const select = useDeckStore((state) => state.select)

  if (open === null) {
    return <p className="p-2 text-xs text-muted">No presentation open</p>
  }

  return (
    <ol className="flex flex-col gap-2 p-2">
      {open.deck.slides.map((slide, index) => (
        <li key={slide.path}>
          <button
            type="button"
            aria-label={`Slide ${String(index + 1)}`}
            aria-current={index === current}
            onClick={() => {
              select(index)
            }}
            className={`flex w-full items-start gap-2 rounded border p-1 text-left ${
              index === current ? 'border-accent' : 'border-transparent'
            }`}
          >
            <span className="w-4 shrink-0 pt-1 text-[10px] text-muted">{index + 1}</span>
            <SlideView
              deck={open.deck}
              slide={slide}
              themes={open.themes}
              className="min-w-0 flex-1 border border-border"
            />
          </button>
        </li>
      ))}
    </ol>
  )
}
