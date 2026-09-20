import { useState } from 'react'

/**
 * "Set this cell to that number by changing this other one."
 *
 * The one thing in a spreadsheet that runs backwards. It cannot really — a
 * formula is a program and nothing can be un-run — so it is done by trying,
 * and the dialog asks for the three things a search needs: what to watch,
 * what it should come to, and what to move.
 */

export interface GoalSeekDialogProps {
  /** The cell the cursor is on, which is what people mean by "this cell". */
  target: string
  onSeek: (asked: { target: string; wanted: string; changing: string }) => void
  onCancel: () => void
}

export function GoalSeekDialog({ target, onSeek, onCancel }: GoalSeekDialogProps) {
  const [watching, setWatching] = useState(target)
  const [wanted, setWanted] = useState('')
  const [changing, setChanging] = useState('')

  const ready = watching.trim() !== '' && wanted.trim() !== '' && changing.trim() !== ''

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Goal Seek"
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
    >
      <form
        className="flex w-[24rem] flex-col gap-3 rounded border border-border bg-bg p-4 text-xs"
        onSubmit={(event) => {
          event.preventDefault()
          if (ready) onSeek({ target: watching, wanted, changing })
        }}
      >
        <h2 className="text-sm">Goal Seek</h2>

        <Field label="Set cell" value={watching} onChange={setWatching} />
        <Field label="To value" value={wanted} onChange={setWanted} />
        <Field label="By changing cell" value={changing} onChange={setChanging} focused />

        <p className="text-muted">
          The cell being changed has to hold a number rather than a formula, and the one being
          watched has to depend on it.
        </p>

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="h-6 rounded px-2 text-muted hover:bg-surface"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!ready}
            className="h-6 rounded bg-accent px-2 text-white disabled:opacity-40"
          >
            Find
          </button>
        </div>
      </form>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  focused = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  focused?: boolean
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="w-28 text-muted">{label}</span>
      <input
        autoFocus={focused}
        aria-label={label}
        value={value}
        spellCheck={false}
        className="h-6 flex-1 rounded border border-border bg-surface px-1 font-mono outline-none focus:border-accent"
        onChange={(event) => {
          onChange(event.target.value)
        }}
      />
    </label>
  )
}
