import { useMemo, useState } from 'react'
import { describeSlides, inspect } from '../document/warnings'
import { useDeckStore } from '../store/deck-store'

/**
 * What is approximate on screen.
 *
 * Dismissible and never blocking: nothing here is an error, and a person who
 * knows their deck has a chart does not need telling twice.
 */
export function WarningsBanner() {
  const open = useDeckStore((state) => state.open)
  const [dismissed, setDismissed] = useState<string | null>(null)

  const warnings = useMemo(() => (open === null ? [] : inspect(open.deck)), [open])
  if (warnings.length === 0 || dismissed === open?.path) return null

  return (
    <div
      role="status"
      className="flex items-start gap-3 border-b border-border bg-surface-2 px-4 py-2 text-xs"
    >
      <ul className="flex-1 space-y-0.5 text-muted">
        {warnings.map((warning) => (
          <li key={warning.message}>
            {warning.message} — {describeSlides(warning.slides)}.
          </li>
        ))}
      </ul>
      <p className="shrink-0 text-muted">Everything is kept in the file.</p>
      <button
        type="button"
        onClick={() => {
          setDismissed(open?.path ?? null)
        }}
        className="shrink-0 rounded border border-border px-1.5 py-0.5 text-muted"
      >
        Dismiss
      </button>
    </div>
  )
}
