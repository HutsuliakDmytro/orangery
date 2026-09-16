import { useState } from 'react'
import { useDocumentStore, uniqueWarnings } from '../store/document-store'

/**
 * "Some content may not display correctly."
 *
 * Non-blocking by design: an unsupported construct is preserved, so the document
 * is safe to edit — the user just needs to know which parts they cannot touch
 * (CLAUDE.md, "never crash, never silently drop").
 */
export function WarningsBanner() {
  const warnings = useDocumentStore((state) => state.warnings)
  const dismissed = useDocumentStore((state) => state.warningsDismissed)
  const dismiss = useDocumentStore((state) => state.dismissWarnings)
  const [expanded, setExpanded] = useState(false)

  if (dismissed || warnings.length === 0) return null

  const distinct = uniqueWarnings(warnings)

  return (
    <div
      role="status"
      className="flex flex-col gap-1 border-b border-border bg-accent-soft px-4 py-2 text-sm text-text"
    >
      <div className="flex items-center gap-3">
        <span>
          Some content may not display correctly. It is preserved and will be saved unchanged.
        </span>

        <button
          type="button"
          onClick={() => {
            setExpanded((open) => !open)
          }}
          aria-expanded={expanded}
          className="rounded border border-border px-2 py-0.5 text-xs"
        >
          {expanded ? 'Hide details' : `Details (${String(distinct.length)})`}
        </button>

        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss warning"
          className="ml-auto rounded px-2 py-0.5 text-xs text-muted"
        >
          ✕
        </button>
      </div>

      {expanded && (
        <ul className="ml-1 list-disc pl-4 text-xs text-muted">
          {distinct.map((warning) => (
            <li key={warning.tag}>{warning.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
