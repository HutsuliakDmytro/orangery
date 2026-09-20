import type { CSSProperties } from 'react'

/**
 * A short list of things the cell could hold, offered while somebody types.
 *
 * Two of them so far, and they are the same list to look at: the functions a
 * half-typed name could become, and the values a column is allowed to hold.
 * One component, because they are one gesture — a list under the caret,
 * walked with the arrows and taken with Enter.
 */

export interface Suggested {
  /** What goes into the cell when it is taken. */
  value: string
  /** What is shown, where that is not the value itself. */
  label?: string
  /** A word or two on the right: how many arguments, what kind of thing. */
  hint?: string
}

export interface SuggestionListProps {
  label: string
  items: readonly Suggested[]
  /** Which one the keyboard is on. */
  highlighted: number
  onChoose: (value: string) => void
  onHighlight: (at: number) => void
  /** Where to put it, for the caller that knows where the editor is. */
  style?: CSSProperties
}

export function SuggestionList({
  label,
  items,
  highlighted,
  onChoose,
  onHighlight,
  style,
}: SuggestionListProps) {
  if (items.length === 0) return null

  return (
    <ul
      aria-label={label}
      className="z-20 max-h-64 w-72 overflow-auto rounded border border-border bg-surface py-1 shadow-lg"
      style={style}
    >
      {items.map((one, at) => (
        <li key={one.value}>
          <button
            type="button"
            className={`flex w-full items-baseline justify-between gap-3 px-2 py-1 text-left text-xs ${
              at === highlighted ? 'bg-accent/15' : ''
            }`}
            // The mouse must not take the focus away from what is being
            // typed in, or the blur would commit a half-written formula
            // before the click had a chance to finish it.
            onMouseDown={(event) => {
              event.preventDefault()
            }}
            onClick={() => {
              onChoose(one.value)
            }}
            onMouseEnter={() => {
              onHighlight(at)
            }}
          >
            <span className="font-mono">{one.label ?? one.value}</span>
            {one.hint !== undefined && <span className="text-muted">{one.hint}</span>}
          </button>
        </li>
      ))}
    </ul>
  )
}
