import { fileNameOf } from '../document/formats'
import type { RecoverableSnapshot } from '../document/autosave'

/**
 * Crash recovery offer. A banner rather than a modal: the user may well prefer
 * to start typing and deal with it later, and a modal would block that.
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
            ? 'A document was not saved before Orangery Docs last closed.'
            : `${String(candidates.length)} documents were not saved before Orangery Docs last closed.`}
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
              {fileNameOf(entry.snapshot.path)}
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
