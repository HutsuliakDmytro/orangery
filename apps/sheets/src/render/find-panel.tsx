import { useState } from 'react'
import type { SearchOptions } from '../document/find'

/**
 * Find, and replace.
 *
 * A strip rather than a dialog: searching is something people do while
 * looking at the sheet, and a box in the middle of the window would cover the
 * thing they are searching. Replace is folded into the same strip, shown when
 * it is wanted, because the two are one gesture apart.
 *
 * The count is the part worth having. "3 of 12" is the answer to the question
 * somebody actually has — whether the thing they typed is in there at all —
 * and it is already known by the time the first match is found.
 */

export interface FindPanelProps {
  onFind: (term: string, options: SearchOptions, backwards?: boolean) => { at: number; of: number }
  onReplace: (term: string, replacement: string, options: SearchOptions) => void
  onReplaceAll: (term: string, replacement: string, options: SearchOptions) => number
  onClose: () => void
}

const START: SearchOptions = {
  within: 'values',
  matchCase: false,
  wholeCell: false,
  everywhere: false,
}

export function FindPanel({ onFind, onReplace, onReplaceAll, onClose }: FindPanelProps) {
  const [term, setTerm] = useState('')
  const [replacement, setReplacement] = useState('')
  const [options, setOptions] = useState(START)
  const [showReplace, setShowReplace] = useState(false)

  /** What the last search said, which is what the count shows. */
  const [count, setCount] = useState<{ at: number; of: number } | null>(null)

  /** How many the last Replace All changed, which is the only report of it. */
  const [replaced, setReplaced] = useState<number | null>(null)

  const find = (backwards = false) => {
    setCount(term === '' ? null : onFind(term, options, backwards))
  }

  return (
    <div
      role="search"
      aria-label="Find"
      className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1 text-xs"
    >
      <input
        type="text"
        aria-label="Find"
        autoFocus
        value={term}
        placeholder="Find"
        className="h-6 w-40 rounded border border-border bg-surface px-1 outline-none focus:border-accent"
        onChange={(event) => {
          setTerm(event.target.value)
          setCount(null)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') find(event.shiftKey)
          if (event.key === 'Escape') onClose()
        }}
      />

      {count !== null && (
        <span className="text-muted">
          {count.of === 0 ? 'No matches' : `${String(count.at)} of ${String(count.of)}`}
        </span>
      )}

      <button
        type="button"
        aria-label="Find previous"
        className="px-1 text-muted hover:text-text"
        onClick={() => {
          find(true)
        }}
      >
        ‹
      </button>
      <button
        type="button"
        aria-label="Find next"
        className="px-1 text-muted hover:text-text"
        onClick={() => {
          find()
        }}
      >
        ›
      </button>

      <Toggle
        label="Match case"
        on={options.matchCase}
        onChange={(on) => {
          setOptions({ ...options, matchCase: on })
        }}
      />
      <Toggle
        label="Whole cell"
        on={options.wholeCell}
        onChange={(on) => {
          setOptions({ ...options, wholeCell: on })
        }}
      />
      <Toggle
        label="In formulas"
        on={options.within === 'formulas'}
        onChange={(on) => {
          setOptions({ ...options, within: on ? 'formulas' : 'values' })
        }}
      />
      <Toggle
        label="All sheets"
        on={options.everywhere}
        onChange={(on) => {
          setOptions({ ...options, everywhere: on })
        }}
      />

      <button
        type="button"
        className="text-accent"
        onClick={() => {
          setShowReplace(!showReplace)
        }}
      >
        {showReplace ? 'Hide replace' : 'Replace…'}
      </button>

      {showReplace && (
        <>
          <input
            type="text"
            aria-label="Replace with"
            value={replacement}
            placeholder="Replace with"
            className="h-6 w-40 rounded border border-border bg-surface px-1 outline-none focus:border-accent"
            onChange={(event) => {
              setReplacement(event.target.value)
            }}
          />
          <button
            type="button"
            className="text-accent"
            onClick={() => {
              if (term !== '') onReplace(term, replacement, options)
            }}
          >
            Replace
          </button>
          <button
            type="button"
            className="text-accent"
            onClick={() => {
              if (term === '') return
              const done = onReplaceAll(term, replacement, options)
              setCount({ at: 0, of: 0 })
              setReplaced(done)
            }}
          >
            Replace all
          </button>
          {replaced !== null && (
            <span className="text-muted">{`${String(replaced)} replaced`}</span>
          )}
        </>
      )}

      <button
        type="button"
        aria-label="Close find"
        className="ml-auto px-1 text-muted hover:text-text"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  )
}

function Toggle({
  label,
  on,
  onChange,
}: {
  label: string
  on: boolean
  onChange: (on: boolean) => void
}) {
  return (
    <label className="flex items-center gap-1">
      <input
        type="checkbox"
        aria-label={label}
        checked={on}
        onChange={() => {
          onChange(!on)
        }}
      />
      <span className="text-muted">{label}</span>
    </label>
  )
}
