import { useState } from 'react'
import { isValidName } from '@orangery/ooxml-spreadsheet'
import type { DefinedName } from '@orangery/ooxml-spreadsheet'

/**
 * The names a workbook gives to formulas.
 *
 * A name is not a cell and not a range: it is a formula somebody has named,
 * which is why one can stand for `0.2` and another for a column. The dialog
 * shows that plainly — a name and a formula, side by side — rather than
 * pretending a name is a selection with a label on it.
 *
 * Nothing is validated beyond the name. What it stands for is a formula, and
 * a dialog that refused `SUM(A1:A9)*1.2` because it could not work it out
 * would be a dialog refusing the useful half of the feature.
 */

export interface NamesDialogProps {
  names: readonly DefinedName[]
  /** What to put in the box for a new name, usually what is selected. */
  suggested: string
  onSave: (names: DefinedName[]) => void
  onCancel: () => void
}

export function NamesDialog({ names, suggested, onSave, onCancel }: NamesDialogProps) {
  const [rows, setRows] = useState<DefinedName[]>([...names])
  const [name, setName] = useState('')
  const [formula, setFormula] = useState(suggested)

  const taken = rows.some((one) => one.name.toLowerCase() === name.trim().toLowerCase())
  const ready = isValidName(name.trim()) && formula.trim() !== '' && !taken

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Defined names"
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
    >
      <div className="flex w-[34rem] flex-col gap-3 rounded border border-border bg-bg p-4 text-xs">
        <h2 className="text-sm">Defined names</h2>

        <ul className="max-h-64 overflow-auto rounded border border-border">
          {rows.length === 0 && (
            <li className="px-2 py-2 text-muted">This workbook has no names yet.</li>
          )}
          {rows.map((one) => (
            <li
              key={one.name}
              className="flex items-baseline gap-2 border-b border-border px-2 py-1 last:border-b-0"
            >
              <span className="w-32 truncate font-mono">{one.name}</span>
              <span className="flex-1 truncate text-muted">{one.formula}</span>
              <button
                type="button"
                aria-label={`Delete ${one.name}`}
                className="text-muted hover:text-fg"
                onClick={() => {
                  setRows(rows.filter((other) => other.name !== one.name))
                }}
              >
                ×
              </button>
            </li>
          ))}
        </ul>

        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            if (!ready) return

            setRows([
              ...rows,
              { name: name.trim(), formula: formula.trim(), sheet: null, hidden: false },
            ])
            setName('')
            setFormula('')
          }}
        >
          <input
            aria-label="Name"
            value={name}
            spellCheck={false}
            placeholder="Tax_Rate"
            className="h-6 w-32 rounded border border-border bg-surface px-1 font-mono outline-none focus:border-accent"
            onChange={(event) => {
              setName(event.target.value)
            }}
          />
          <input
            aria-label="Refers to"
            value={formula}
            spellCheck={false}
            placeholder="Sheet1!$A$1:$A$9"
            className="h-6 flex-1 rounded border border-border bg-surface px-1 font-mono outline-none focus:border-accent"
            onChange={(event) => {
              setFormula(event.target.value)
            }}
          />
          <button
            type="submit"
            disabled={!ready}
            className="h-6 rounded border border-border px-2 disabled:opacity-40"
          >
            Add
          </button>
        </form>

        {name.trim() !== '' && !isValidName(name.trim()) && (
          <p className="text-muted">
            A name has to start with a letter and hold no spaces, and cannot look like a cell
            address.
          </p>
        )}
        {taken && <p className="text-muted">There is already a name spelled that way.</p>}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="h-6 rounded px-2 text-muted hover:bg-surface"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="button"
            className="h-6 rounded bg-accent px-2 text-white"
            onClick={() => {
              onSave(rows)
            }}
          >
            Save
          </button>
        </div>
      </div>
    </div>
  )
}
