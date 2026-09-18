import { useEffect, useState } from 'react'
import { PickerPopover } from '@orangery/ui-kit'
import { addNarration, setAdvanceTime } from '@orangery/ooxml-presentation'
import { useNarration } from '../document/use-narration'
import { useDeckStore } from '../store/deck-store'
import { useShowStore } from '../store/show-store'

/**
 * How long the run took, slide by slide.
 *
 * Shown after a rehearsal and not after an ordinary show: every run is timed
 * because the presenter wants to know how long they have been on this slide,
 * but only a rehearsal was started in order to produce numbers.
 *
 * Keeping them writes `advTm` on each slide — the timing and nothing else. A
 * deck that began dissolving because it was practised would be a deck changed
 * by being practised.
 *
 * A run that was recorded brings its narration here too, because it is the same
 * question asked once: what happened during the run, and is any of it worth
 * keeping. Two dialogs in a row would be two answers to one decision.
 */

/** Milliseconds as a presenter reads them. */
function spoken(milliseconds: number): string {
  const seconds = Math.round(milliseconds / 1000)
  return `${String(Math.floor(seconds / 60))}:${String(seconds % 60).padStart(2, '0')}`
}

export function RehearsalSummary() {
  const open = useDeckStore((state) => state.open)
  const editDeck = useDeckStore((state) => state.editDeck)
  const [times, setTimes] = useState<number[] | null>(null)
  const narration = useNarration()

  useEffect(() => {
    const stop = useShowStore.subscribe((state, before) => {
      // The moment the run ended, which is the only moment the numbers exist:
      // the store is about to forget where it was.
      if (state.at !== null || before.at === null || !before.rehearsing) return
      setTimes(state.spent)
    })

    return stop
  }, [])

  if (times === null || open === null) return null

  const close = () => {
    setTimes(null)
  }

  const keep = () => {
    editDeck((deck) => {
      const written = deck.slides.map((slide, index) => {
        const timed = setAdvanceTime(slide, Math.max(times[index] ?? 0, 0))

        const recorded = narration?.[index]
        const sound =
          recorded === undefined ? false : addNarration(open.package, slide, recorded) !== null

        return timed || sound
      })
      return written.some(Boolean)
    })
    close()
  }

  const total = times.reduce((sum, one) => sum + one, 0)
  const recordings = narration === null ? 0 : Object.keys(narration).length

  return (
    <PickerPopover title="Rehearsal" onClose={close}>
      <div className="w-72 space-y-3 text-xs text-text">
        <p className="text-muted">
          {`${String(open.deck.slides.length)} slides in ${spoken(total)}.`}
          {recordings === 0
            ? ''
            : recordings === 1
              ? ' One slide was recorded.'
              : ` ${String(recordings)} slides were recorded.`}
        </p>

        <ol className="max-h-64 space-y-0.5 overflow-y-auto">
          {open.deck.slides.map((slide, index) => (
            <li key={slide.path} className="flex justify-between gap-2">
              <span className="text-muted">Slide {index + 1}</span>
              <span className="tabular-nums">{spoken(times[index] ?? 0)}</span>
            </li>
          ))}
        </ol>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={close}
            className="rounded border border-border px-3 py-1 hover:border-accent"
          >
            Discard
          </button>
          <button
            type="button"
            onClick={keep}
            className="rounded bg-accent px-3 py-1 text-black hover:bg-accent-hover"
          >
            {recordings === 0 ? 'Keep timings' : 'Keep timings and narration'}
          </button>
        </div>
      </div>
    </PickerPopover>
  )
}
