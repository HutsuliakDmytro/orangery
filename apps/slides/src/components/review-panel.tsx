import { describeChange } from '@orangery/ooxml-presentation'
import { accept, reject, useReviewStore } from '../document/review'
import { useDeckStore } from '../store/deck-store'

/**
 * The differences between this deck and one somebody sent back.
 *
 * Every change says which slide it is on and takes you there, because a
 * difference you cannot see is one nobody can decide about.
 *
 * Every change can be taken, including one about a whole slide: that one
 * brings the slide's layout, its pictures and the parts they live in, which is
 * why it took its own piece of work rather than a branch of this one.
 */
export function ReviewPanel() {
  const theirs = useReviewStore((state) => state.theirs)
  const changes = useReviewStore((state) => state.changes)
  const settled = useReviewStore((state) => state.settled)
  const end = useReviewStore((state) => state.end)
  const select = useDeckStore((state) => state.select)

  if (theirs === null) return null
  const left = changes.filter((_, index) => !settled.includes(index))

  return (
    <section
      aria-label="Review"
      className="flex w-72 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-surface p-2 text-xs"
    >
      <header className="flex items-center gap-2">
        <h2 className="flex-1 uppercase tracking-wide text-muted">Review</h2>
        <button
          type="button"
          aria-label="End review"
          onClick={end}
          className="rounded border border-border px-1.5 py-0.5 text-muted"
        >
          ×
        </button>
      </header>

      {left.length === 0 ? (
        <p className="text-muted">
          {changes.length === 0
            ? 'The two decks are the same.'
            : 'Every change has been dealt with.'}
        </p>
      ) : (
        <ol className="space-y-2">
          {changes.map((change, index) =>
            settled.includes(index) ? null : (
              <li key={index} className="space-y-1 rounded border border-border p-2">
                <button
                  type="button"
                  onClick={() => {
                    select(change.slide - 1)
                  }}
                  className="text-left text-muted hover:text-text"
                >
                  Slide {change.slide}
                </button>
                <p className="text-text">{describeChange(change)}</p>

                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={`Accept change ${String(index + 1)}`}
                    onClick={() => {
                      accept(index)
                    }}
                    className="rounded bg-accent px-2 py-0.5 text-black"
                  >
                    Accept
                  </button>
                  <button
                    type="button"
                    aria-label={`Reject change ${String(index + 1)}`}
                    onClick={() => {
                      reject(index)
                    }}
                    className="rounded border border-border px-2 py-0.5 text-muted"
                  >
                    Reject
                  </button>
                </div>
              </li>
            ),
          )}
        </ol>
      )}
    </section>
  )
}
