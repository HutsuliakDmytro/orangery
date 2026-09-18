import { useMemo, useState } from 'react'
import { findInDeck, replaceInDeck } from '@orangery/ooxml-presentation'
import { useDeckStore } from '../store/deck-store'

/**
 * Finding and replacing across the deck.
 *
 * Matches are counted rather than stepped through for now: the useful question
 * when replacing across a hundred slides is how many there are, and jumping to
 * each one needs a selection inside text that the editor does not yet expose.
 */
export function FindPanel({ onClose }: { onClose: () => void }) {
  const open = useDeckStore((state) => state.open)
  const editDeck = useDeckStore((state) => state.editDeck)
  const select = useDeckStore((state) => state.select)
  const selectShapes = useDeckStore((state) => state.selectShapes)

  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [caseSensitive, setCaseSensitive] = useState(false)

  const matches = useMemo(
    () => (open === null || query === '' ? [] : findInDeck(open.deck, query, { caseSensitive })),
    [open, query, caseSensitive],
  )

  const [at, setAt] = useState(0)

  /**
   * Goes to a match: the slide it is on, and the shape it is in.
   *
   * Both, because a slide with forty shapes on it is not an answer to "where is
   * this word". Wrapping round rather than stopping at the ends — a search that
   * refuses to continue is one you have to restart by hand.
   */
  const goTo = (index: number) => {
    if (matches.length === 0) return

    const wrapped = ((index % matches.length) + matches.length) % matches.length
    const match = matches[wrapped]
    if (match === undefined) return

    setAt(wrapped)
    select(match.slide - 1)
    selectShapes([match.shapeId])
  }

  if (open === null) return null

  // The count changes as the query is typed, and a position inside the old list
  // means nothing in the new one.
  const here = at < matches.length ? at : 0

  return (
    <section
      aria-label="Find and replace"
      className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs"
    >
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
        }}
        aria-label="Find"
        placeholder="Find"
        onKeyDown={(event) => {
          if (event.key !== 'Enter') return
          event.preventDefault()
          // Enter steps forward and Shift+Enter back, which is what the field
          // does in every editor that has one.
          goTo(here + (event.shiftKey ? -1 : 1))
        }}
        className="rounded border border-border bg-transparent px-2 py-1 text-text outline-none focus:border-accent"
      />
      <input
        value={replacement}
        onChange={(event) => {
          setReplacement(event.target.value)
        }}
        aria-label="Replace with"
        placeholder="Replace with"
        className="rounded border border-border bg-transparent px-2 py-1 text-text outline-none focus:border-accent"
      />

      <label className="flex items-center gap-1 text-muted">
        <input
          type="checkbox"
          checked={caseSensitive}
          onChange={(event) => {
            setCaseSensitive(event.target.checked)
          }}
        />
        Match case
      </label>

      <button
        type="button"
        disabled={matches.length === 0}
        onClick={() => {
          editDeck((deck) => replaceInDeck(deck, query, replacement, { caseSensitive }) > 0)
        }}
        className="rounded border border-border px-2 py-1 text-text disabled:text-muted"
      >
        Replace all
      </button>

      <p className="text-muted" role="status">
        {query === ''
          ? ''
          : matches.length === 0
            ? 'No matches'
            : `${String(here + 1)} of ${String(matches.length)} on ${String(new Set(matches.map((match) => match.slide)).size)} slides`}
      </p>

      <div className="flex gap-1">
        <button
          type="button"
          aria-label="Previous match"
          disabled={matches.length === 0}
          onClick={() => {
            goTo(here - 1)
          }}
          className="rounded border border-border px-2 py-1 text-text disabled:text-muted"
        >
          ‹
        </button>
        <button
          type="button"
          aria-label="Next match"
          disabled={matches.length === 0}
          onClick={() => {
            goTo(here + 1)
          }}
          className="rounded border border-border px-2 py-1 text-text disabled:text-muted"
        >
          ›
        </button>
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close find"
        className="ml-auto rounded border border-border px-2 py-1 text-muted"
      >
        Done
      </button>
    </section>
  )
}
