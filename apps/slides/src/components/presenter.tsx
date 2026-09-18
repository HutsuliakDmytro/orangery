import { useEffect, useState } from 'react'
import { readSlidePart } from '@orangery/ooxml-presentation'
import { textOfBody } from '@orangery/ooxml-drawingml'
import { SlideView } from '../render/slide-view'
import { useDeckStore } from '../store/deck-store'
import { useShowStore } from '../store/show-store'

/**
 * What the presenter sees while the room sees the slide.
 *
 * The slide that is up, the one coming, the notes for the current one, how long
 * this has been going on, and what time it is — the five things somebody
 * standing in front of a room actually wants, and nothing else competing for
 * the same glance.
 *
 * It draws the same slides with the same renderer. A presenter view that could
 * disagree with the screen would be worse than none: the whole point is to know
 * what the room is looking at without turning round.
 */

/** Elapsed time, ticking once a second and not in the store. */
function useElapsed(since: number | null): string {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (since === null) return

    const timer = setInterval(() => {
      setNow(Date.now())
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [since])

  if (since === null) return '0:00'

  const seconds = Math.max(Math.floor((now - since) / 1000), 0)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)
  const pad = (value: number) => String(value).padStart(2, '0')

  return hours > 0
    ? `${String(hours)}:${pad(minutes % 60)}:${pad(seconds % 60)}`
    : `${String(minutes)}:${pad(seconds % 60)}`
}

/** The wall clock, which is the other number a presenter looks at. */
function useClock(): string {
  const [now, setNow] = useState(() => new Date())

  useEffect(() => {
    const timer = setInterval(() => {
      setNow(new Date())
    }, 1000)
    return () => {
      clearInterval(timer)
    }
  }, [])

  return now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

export function Presenter() {
  const open = useDeckStore((state) => state.open)
  const at = useShowStore((state) => state.at)
  const startedAt = useShowStore((state) => state.startedAt)
  const enteredAt = useShowStore((state) => state.enteredAt)
  const notesScale = useShowStore((state) => state.notesScale)

  const elapsed = useElapsed(startedAt)
  // The other number a presenter needs: not how long the talk has run, but how
  // long they have been on this one slide.
  const here = useElapsed(enteredAt)
  const clock = useClock()

  if (open === null || at === null) return null

  const slides = open.deck.slides
  const slide = slides[at]
  const next = slides[at + 1]
  if (slide === undefined) return null

  const notes = (() => {
    if (slide.notes == null) return ''

    const part = readSlidePart(open.package, slide.notes)
    const body = part?.shapes.find((shape) => shape.placeholder?.type === 'body')
    return body?.text == null ? '' : textOfBody(body.text)
  })()

  const show = () => useShowStore.getState()

  return (
    <div
      data-testid="presenter"
      className="fixed inset-0 z-50 flex flex-col gap-3 bg-black p-4 text-white"
    >
      <header className="flex items-baseline gap-4 text-sm">
        <span className="text-2xl tabular-nums" aria-label="Time on this presentation">
          {elapsed}
        </span>
        <span className="text-white/60 tabular-nums" aria-label="Time on this slide">
          {here}
        </span>
        <span className="text-white/60 tabular-nums" aria-label="Clock">
          {clock}
        </span>
        <span className="ml-auto text-white/60">
          Slide {at + 1} of {slides.length}
        </span>
      </header>

      <div className="flex min-h-0 flex-1 gap-4">
        <div className="flex min-w-0 flex-[3] flex-col gap-2">
          <SlideView
            deck={open.deck}
            slide={slide}
            themes={open.themes}
            package={open.package}
            className="w-full"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                show().previous()
              }}
              className="rounded border border-white/20 px-3 py-1 text-sm"
            >
              Previous
            </button>
            <button
              type="button"
              onClick={() => {
                show().next()
              }}
              className="rounded border border-white/20 px-3 py-1 text-sm"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => {
                show().setBlank(show().blank === 'black' ? null : 'black')
              }}
              className="rounded border border-white/20 px-3 py-1 text-sm"
            >
              Blank
            </button>
            <button
              type="button"
              onClick={() => {
                show().end()
              }}
              className="ml-auto rounded border border-white/20 px-3 py-1 text-sm"
            >
              End show
            </button>
          </div>
        </div>

        <div className="flex min-w-0 flex-[2] flex-col gap-2">
          <section aria-label="Next slide" className="shrink-0">
            {next === undefined ? (
              <p className="rounded border border-white/20 p-4 text-sm text-white/60">Last slide</p>
            ) : (
              <SlideView
                deck={open.deck}
                slide={next}
                themes={open.themes}
                package={open.package}
                className="w-full opacity-80"
              />
            )}
          </section>

          <section aria-label="Notes" className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-2 pb-1 text-xs text-white/60">
              <span>Notes</span>
              <button
                type="button"
                aria-label="Smaller notes"
                onClick={() => {
                  show().scaleNotes(-0.25)
                }}
                className="rounded border border-white/20 px-2"
              >
                −
              </button>
              <button
                type="button"
                aria-label="Larger notes"
                onClick={() => {
                  show().scaleNotes(0.25)
                }}
                className="rounded border border-white/20 px-2"
              >
                +
              </button>
            </div>
            <p
              data-testid="presenter-notes"
              style={{ fontSize: `${String(notesScale)}rem` }}
              className="min-h-0 flex-1 overflow-y-auto whitespace-pre-wrap leading-snug"
            >
              {notes === '' ? <span className="text-white/40">No notes</span> : notes}
            </p>
          </section>
        </div>
      </div>

      <nav aria-label="Slides" className="flex shrink-0 gap-2 overflow-x-auto">
        {slides.map((one, index) => (
          <button
            key={one.path}
            type="button"
            aria-label={`Go to slide ${String(index + 1)}`}
            aria-current={index === at}
            onClick={() => {
              show().go(index)
            }}
            className={`w-24 shrink-0 rounded border p-0.5 ${
              index === at ? 'border-accent' : 'border-white/20'
            }`}
          >
            <SlideView
              deck={open.deck}
              slide={one}
              themes={open.themes}
              package={open.package}
              className="w-full"
            />
          </button>
        ))}
      </nav>
    </div>
  )
}
