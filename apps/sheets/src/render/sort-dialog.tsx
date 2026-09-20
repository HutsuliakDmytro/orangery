import { useState } from 'react'
import { CUSTOM_LISTS } from '../document/sort'
import type { SortKey } from '../document/sort'

/**
 * Sorting by more than one column.
 *
 * The toolbar's two buttons sort by the column the cursor is in, which is
 * what people want most of the time. This is for the rest of the time: by
 * region and then by date, oldest first, with the top row left where it is.
 *
 * The levels are applied in the order they are shown, which is the only order
 * they could be applied in and the reason they are shown as a list rather
 * than as three equal dropdowns.
 */

export interface SortDialogProps {
  /** What to call each column, in order from the left of the table. */
  columns: readonly string[]
  /** Whether the top row looks like names, which is a guess to be corrected. */
  header: boolean
  onSort: (keys: readonly SortKey[], header: boolean) => void
  onCancel: () => void
}

/** A level of the sort: which column, and in what order. */
interface Level {
  column: number
  ascending: boolean
  /** An index into the lists, or null for the ordinary order. */
  list: number | null
}

const ORDERS = [
  { label: 'A → Z', ascending: true, list: null },
  { label: 'Z → A', ascending: false, list: null },
  ...CUSTOM_LISTS.map((one, index) => ({ label: one.label, ascending: true, list: index })),
]

const orderOf = (level: Level): number =>
  level.list !== null ? ORDERS.findIndex((one) => one.list === level.list) : level.ascending ? 0 : 1

export function SortDialog({ columns, header, onSort, onCancel }: SortDialogProps) {
  const [levels, setLevels] = useState<Level[]>([{ column: 0, ascending: true, list: null }])
  const [named, setNamed] = useState(header)

  const change = (at: number, level: Level) => {
    setLevels(levels.map((one, index) => (index === at ? level : one)))
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Sort range"
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
    >
      <div className="flex w-[32rem] flex-col gap-3 rounded border border-border bg-bg p-4 text-xs">
        <h2 className="text-sm">Sort range</h2>

        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            aria-label="Data has a header row"
            checked={named}
            onChange={() => {
              setNamed(!named)
            }}
          />
          <span className="text-muted">Data has a header row</span>
        </label>

        {levels.map((level, index) => (
          <div key={`level-${String(index)}`} className="flex items-center gap-2">
            <span className="w-14 text-muted">{index === 0 ? 'Sort by' : 'then by'}</span>

            <select
              aria-label={index === 0 ? 'Sort by' : `Then by ${String(index)}`}
              value={String(level.column)}
              className="h-6 flex-1 rounded border border-border bg-surface px-1 outline-none focus:border-accent"
              onChange={(event) => {
                change(index, { ...level, column: Number(event.target.value) })
              }}
            >
              {columns.map((name, column) => (
                <option key={`column-${String(column)}`} value={String(column)}>
                  {name}
                </option>
              ))}
            </select>

            <select
              aria-label={index === 0 ? 'Order' : `Order ${String(index)}`}
              value={String(orderOf(level))}
              className="h-6 rounded border border-border bg-surface px-1 outline-none focus:border-accent"
              onChange={(event) => {
                const picked = ORDERS[Number(event.target.value)]
                if (picked !== undefined) {
                  change(index, { ...level, ascending: picked.ascending, list: picked.list })
                }
              }}
            >
              {ORDERS.map((one, at) => (
                <option key={one.label} value={String(at)}>
                  {one.label}
                </option>
              ))}
            </select>

            {levels.length > 1 && (
              <button
                type="button"
                aria-label={`Remove level ${String(index + 1)}`}
                className="text-muted hover:text-text"
                onClick={() => {
                  setLevels(levels.filter((_, other) => other !== index))
                }}
              >
                ×
              </button>
            )}
          </div>
        ))}

        {/* No more levels than there are columns: a second sort by the same
            column decides nothing the first one has not already decided. */}
        {levels.length < columns.length && (
          <button
            type="button"
            className="self-start text-accent"
            onClick={() => {
              const next = columns.findIndex(
                (_, column) => !levels.some((one) => one.column === column),
              )
              setLevels([...levels, { column: Math.max(next, 0), ascending: true, list: null }])
            }}
          >
            Add another column
          </button>
        )}

        <div className="flex justify-end gap-3">
          <button type="button" className="text-muted hover:text-text" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="text-accent"
            onClick={() => {
              onSort(
                levels.map((level) => ({
                  column: level.column,
                  ascending: level.ascending,
                  ...(level.list === null ? {} : { order: CUSTOM_LISTS[level.list]?.values ?? [] }),
                })),
                named,
              )
            }}
          >
            Sort
          </button>
        </div>
      </div>
    </div>
  )
}
