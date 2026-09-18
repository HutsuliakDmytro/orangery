import { useEffect, useState } from 'react'
import { PickerPopover } from '@orangery/ui-kit'
import { addInkStroke } from '@orangery/ooxml-presentation'
import type { Stroke } from '../store/show-store'
import { useDeckStore } from '../store/deck-store'
import { useShowStore } from '../store/show-store'

/**
 * What to do with what was drawn during the show.
 *
 * PowerPoint asks the same question on the way out, and asking is the right
 * shape for it: ink is sometimes the answer to a question from the room and
 * sometimes a line through a typo, and only the person who drew it knows which.
 *
 * Kept, it becomes a freeform line on the slide — a shape, not ink as
 * PowerPoint stores it. What the room saw is what the file gets, and it opens
 * everywhere; the difference is that ours can be selected afterwards.
 */
export function InkPrompt() {
  const editDeck = useDeckStore((state) => state.editDeck)
  const [ink, setInk] = useState<Record<number, Stroke[]> | null>(null)

  useEffect(() => {
    const stop = useShowStore.subscribe((state, before) => {
      // The moment the show ended, which is the only moment the strokes exist:
      // the store keeps them for the run and not beyond it.
      if (state.at !== null || before.at === null) return

      const drawn = Object.values(state.ink).some((strokes) => strokes.length > 0)
      if (drawn) setInk(state.ink)
    })

    return stop
  }, [])

  if (ink === null) return null

  const close = () => {
    setInk(null)
  }

  const keep = () => {
    editDeck((deck) => {
      const written = deck.slides.map((slide, index) =>
        (ink[index] ?? []).map((stroke) => addInkStroke(slide, stroke)).some((id) => id !== null),
      )
      return written.some(Boolean)
    })
    close()
  }

  const count = Object.values(ink).reduce((sum, strokes) => sum + strokes.length, 0)

  return (
    <PickerPopover title="Ink" onClose={close}>
      <div className="w-64 space-y-3 text-xs text-text">
        <p className="text-muted">
          {count === 1
            ? 'One mark was drawn during the show.'
            : `${String(count)} marks were drawn during the show.`}
        </p>

        <div className="flex justify-end gap-2">
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
            Keep ink
          </button>
        </div>
      </div>
    </PickerPopover>
  )
}
