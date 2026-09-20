import { useState } from 'react'

/**
 * Where a cell goes.
 *
 * Two boxes, because a link is two things: where it points and what it says
 * while the pointer waits over it. What kind of link it is — a place in this
 * workbook or an address out on the internet — is not asked, because it can
 * be read off what somebody typed: `Notes!A1` is a reference and
 * `example.org` is not.
 */

export interface LinkDialogProps {
  /** What the cell already links to, for a link being changed rather than made. */
  address: string
  tooltip: string
  onApply: (address: string, tooltip: string | null) => void
  onRemove: () => void
  onCancel: () => void
}

export function LinkDialog({ address, tooltip, onApply, onRemove, onCancel }: LinkDialogProps) {
  const [where, setWhere] = useState(address)
  const [said, setSaid] = useState(tooltip)

  const apply = () => {
    if (where.trim() !== '') onApply(where.trim(), said.trim() === '' ? null : said.trim())
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Link"
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
    >
      <div className="flex w-[28rem] flex-col gap-3 rounded border border-border bg-bg p-4 text-xs">
        <h2 className="text-sm">Link</h2>

        <label className="flex flex-col gap-1">
          <span className="text-muted">Address or reference</span>
          <input
            type="text"
            aria-label="Address"
            autoFocus
            value={where}
            placeholder="example.org or Notes!A1"
            className="h-7 rounded border border-border bg-surface px-2 outline-none focus:border-accent"
            onChange={(event) => {
              setWhere(event.target.value)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') apply()
              if (event.key === 'Escape') onCancel()
            }}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-muted">Tooltip</span>
          <input
            type="text"
            aria-label="Tooltip"
            value={said}
            className="h-7 rounded border border-border bg-surface px-2 outline-none focus:border-accent"
            onChange={(event) => {
              setSaid(event.target.value)
            }}
          />
        </label>

        <div className="flex items-center justify-end gap-3">
          {address !== '' && (
            <button type="button" className="mr-auto text-muted hover:text-text" onClick={onRemove}>
              Remove link
            </button>
          )}
          <button type="button" className="text-muted hover:text-text" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="text-accent" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
