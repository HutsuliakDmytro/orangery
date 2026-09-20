import type { CSSProperties } from 'react'
import { shape } from '../document/suggest'
import type { KnownFunction } from '../document/suggest'

/**
 * The functions a half-typed name could become.
 *
 * One list, shown in two places: under the formula bar and under the cell
 * being edited. They are the same question asked from two keyboards, and two
 * lists that drifted apart would be two answers to it.
 */

export interface FunctionListProps {
  matches: readonly KnownFunction[]
  /** Which one the keyboard is on. */
  highlighted: number
  onChoose: (name: string) => void
  onHighlight: (at: number) => void
  /** Where to put it, for the caller that knows where the editor is. */
  style?: CSSProperties
}

export function FunctionList({
  matches,
  highlighted,
  onChoose,
  onHighlight,
  style,
}: FunctionListProps) {
  if (matches.length === 0) return null

  return (
    <ul
      aria-label="Functions"
      className="z-20 max-h-64 w-72 overflow-auto rounded border border-border bg-surface py-1 shadow-lg"
      style={style}
    >
      {matches.map((one, at) => (
        <li key={one.name}>
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
              onChoose(one.name)
            }}
            onMouseEnter={() => {
              onHighlight(at)
            }}
          >
            <span className="font-mono">{one.name}</span>
            <span className="text-muted">{shape(one)}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}
