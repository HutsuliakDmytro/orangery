import { useState } from 'react'
import type { AutoFilter } from '@orangery/ooxml-spreadsheet'

/**
 * The list behind a filter arrow.
 *
 * Every value the column actually holds, each with a tick. Not a query
 * builder: the thing people do with a filter nine times in ten is untick one
 * value, and a box of operators in front of that would be a box in the way.
 *
 * "Blanks" is its own line because an empty cell is not the value "" — a cell
 * can hold that — and a filter that lumped them together would hide rows
 * somebody had deliberately left empty.
 */

export interface FilterMenuProps {
  filter: AutoFilter
  /** Counting from the left of the filter's range, as the file does. */
  column: number
  /** Every value in the column, and whether it has any empty cells. */
  choices: { values: string[]; blanks: boolean }
  at: { left: number; top: number }
  onApply: (criteria: { values: string[]; blanks: boolean } | null) => void
  onClose: () => void
}

export function FilterMenu({ filter, column, choices, at, onApply, onClose }: FilterMenuProps) {
  const criteria = filter.columns.find((one) => one.column === column)

  // No criteria means everything passes, so the box opens with everything
  // ticked — which is what it is showing, not a default it invented.
  const [kept, setKept] = useState(
    () => new Set(criteria === undefined ? choices.values : criteria.values),
  )
  const [blanks, setBlanks] = useState(criteria === undefined ? choices.blanks : criteria.blanks)

  const all = kept.size === choices.values.length && blanks === choices.blanks

  return (
    <div
      role="dialog"
      aria-label="Filter"
      className="absolute z-10 w-52 rounded border border-border bg-surface p-2 text-xs text-text shadow-lg"
      style={{ left: at.left, top: at.top }}
    >
      <label className="flex items-center gap-2 border-b border-border pb-1">
        <input
          type="checkbox"
          checked={all}
          aria-label="Select all"
          onChange={() => {
            setKept(new Set(all ? [] : choices.values))
            setBlanks(!all && choices.blanks)
          }}
        />
        <span>Select all</span>
      </label>

      <div className="max-h-48 overflow-auto py-1">
        {choices.values.map((value) => (
          <label key={value} className="flex items-center gap-2 py-0.5">
            <input
              type="checkbox"
              checked={kept.has(value)}
              aria-label={value}
              onChange={() => {
                const next = new Set(kept)
                if (next.has(value)) next.delete(value)
                else next.add(value)
                setKept(next)
              }}
            />
            <span className="truncate">{value}</span>
          </label>
        ))}

        {choices.blanks && (
          <label className="flex items-center gap-2 py-0.5">
            <input
              type="checkbox"
              checked={blanks}
              aria-label="Blanks"
              onChange={() => {
                setBlanks(!blanks)
              }}
            />
            <span className="text-muted">(Blanks)</span>
          </label>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-border pt-1">
        <button type="button" className="text-muted hover:text-text" onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className="text-accent"
          onClick={() => {
            // Everything ticked is not a filter; clearing the criteria says so
            // and leaves the arrow plain rather than marked.
            onApply(all ? null : { values: [...kept], blanks })
          }}
        >
          Apply
        </button>
      </div>
    </div>
  )
}
