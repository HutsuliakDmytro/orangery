import type { RecoverableSnapshot } from '../document/autosave'
import { nameOf } from '../document/file'

/**
 * The offer to put back work a crash interrupted.
 *
 * A banner rather than a modal: the person may well want to get on with the
 * deck in front of them and deal with this after, and a modal would not let
 * them.
 */
export function RecoveryBanner({
  candidates,
  onRecover,
  onDiscard,
  onDiscardAll,
}: {
  candidates: RecoverableSnapshot[]
  onRecover: (entry: RecoverableSnapshot) => void
  onDiscard: (entry: RecoverableSnapshot) => void
  onDiscardAll: () => void
}) {
  if (candidates.length === 0) return null

  return (
    <div
      role="status"
      className="flex flex-col gap-2 border-b border-border bg-surface-2 px-4 py-2 text-sm text-text"
    >
      <div className="flex items-center gap-3">
        <span>
          {candidates.length === 1
            ? 'A presentation was not saved before Orangery Slides last closed.'
            : `${String(candidates.length)} presentations were not saved before Orangery Slides last closed.`}
        </span>
        <button
          type="button"
          onClick={onDiscardAll}
          className="ml-auto rounded px-2 py-0.5 text-xs text-muted"
        >
          Discard all
        </button>
      </div>

      <ul className="flex flex-col gap-1">
        {candidates.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2 text-xs">
            <span className="text-muted">
              {/* A deck that was never saved has no name to give; what it has
                  is what the window called it while it was open. */}
              {entry.snapshot.path === null ? 'Untitled Presentation' : nameOf(entry.snapshot.path)}
              {entry.snapshot.savedAt !== '' &&
                ` — ${new Date(entry.snapshot.savedAt).toLocaleString()}`}
            </span>
            <button
              type="button"
              onClick={() => {
                onRecover(entry)
              }}
              className="rounded bg-accent px-2 py-0.5 text-black"
            >
              Recover
            </button>
            <button
              type="button"
              onClick={() => {
                onDiscard(entry)
              }}
              className="rounded border border-border px-2 py-0.5"
            >
              Discard
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
