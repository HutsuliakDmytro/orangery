import { useState } from 'react'
import type { AutoFilter, FilterCriteria } from '@orangery/ooxml-spreadsheet'
import { conditionFor, conditionShown } from '../document/filter'
import type { ConditionKind } from '../document/filter'

/**
 * The list behind a filter arrow.
 *
 * Every value the column actually holds, each with a tick. That is the thing
 * people do with a filter nine times in ten, so it is what the box opens on,
 * and the condition — greater than, contains — is a line above it that stays
 * out of the way until somebody uses it.
 *
 * The two are alternatives rather than both, because the file holds one or
 * the other and a box that offered both would be offering a state no
 * spreadsheet can save.
 *
 * "Blanks" is its own line because an empty cell is not the value "" — a cell
 * can hold that — and a filter that lumped them together would hide rows
 * somebody had deliberately left empty.
 */

/** What the condition line offers, in the words people use for it. */
const CONDITIONS: { value: ConditionKind | ''; label: string }[] = [
  { value: '', label: 'No condition' },
  { value: 'equals', label: 'Is equal to' },
  { value: 'notEquals', label: 'Is not equal to' },
  { value: 'greaterThan', label: 'Is greater than' },
  { value: 'greaterThanOrEqual', label: 'Is at least' },
  { value: 'lessThan', label: 'Is less than' },
  { value: 'lessThanOrEqual', label: 'Is at most' },
  { value: 'contains', label: 'Contains' },
  { value: 'notContains', label: 'Does not contain' },
  { value: 'beginsWith', label: 'Begins with' },
  { value: 'endsWith', label: 'Ends with' },
]

export interface FilterMenuProps {
  filter: AutoFilter
  /** Counting from the left of the filter's range, as the file does. */
  column: number
  /** Every value in the column, and whether it has any empty cells. */
  choices: { values: string[]; blanks: boolean }
  at: { left: number; top: number }
  onApply: (criteria: FilterCriteria | null) => void
  onClose: () => void
}

export function FilterMenu({ filter, column, choices, at, onApply, onClose }: FilterMenuProps) {
  const criteria = filter.columns.find((one) => one.column === column)?.criteria
  const listed = criteria?.kind === 'values' ? criteria : null

  // No criteria means everything passes, so the box opens with everything
  // ticked — which is what it is showing, not a default it invented.
  const [kept, setKept] = useState(() => new Set(listed === null ? choices.values : listed.values))
  const [blanks, setBlanks] = useState(listed === null ? choices.blanks : listed.blanks)

  // The condition the column already has, said the way somebody would say it.
  const stated =
    criteria?.kind === 'conditions' && criteria.conditions[0] !== undefined
      ? conditionShown(criteria.conditions[0])
      : null

  const [kind, setKind] = useState<ConditionKind | ''>(stated?.kind ?? '')
  const [text, setText] = useState(stated?.text ?? '')

  const all = kept.size === choices.values.length && blanks === choices.blanks

  return (
    <div
      role="dialog"
      aria-label="Filter"
      className="absolute z-10 w-52 rounded border border-border bg-surface p-2 text-xs text-text shadow-lg"
      style={{ left: at.left, top: at.top }}
    >
      <div className="flex flex-col gap-1 border-b border-border pb-1">
        <select
          aria-label="Condition"
          value={kind}
          className="h-6 rounded border border-border bg-bg px-1 outline-none focus:border-accent"
          onChange={(event) => {
            setKind(event.target.value as ConditionKind | '')
          }}
        >
          {CONDITIONS.map((one) => (
            <option key={one.label} value={one.value}>
              {one.label}
            </option>
          ))}
        </select>

        {kind !== '' && (
          <input
            type="text"
            aria-label="Condition value"
            value={text}
            className="h-6 rounded border border-border bg-bg px-1 outline-none focus:border-accent"
            onChange={(event) => {
              setText(event.target.value)
            }}
          />
        )}
      </div>

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
            // A condition wins where there is one: the file holds one kind of
            // criteria or the other, and the condition is the one somebody
            // had to type into.
            if (kind !== '') {
              onApply({ kind: 'conditions', all: false, conditions: [conditionFor(kind, text)] })
              return
            }

            // Everything ticked is not a filter; clearing the criteria says so
            // and leaves the arrow plain rather than marked.
            onApply(all ? null : { kind: 'values', values: [...kept], blanks })
          }}
        >
          Apply
        </button>
      </div>
    </div>
  )
}
