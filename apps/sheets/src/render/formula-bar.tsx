import { useEffect, useRef, useState } from 'react'
import { chosen, functionsKnownSoFar, knownFunctions, shape, suggest } from '../document/suggest'
import type { KnownFunction } from '../document/suggest'
import { SuggestionList } from './suggestion-list'

/**
 * The strip that shows what is in the cell rather than what it looks like.
 *
 * A spreadsheet has two answers for every cell — what it shows and what it
 * holds — and the grid can only draw one of them. This is the other: the
 * formula behind a number, the full precision behind a rounded figure, the
 * text behind a column that was too narrow for it.
 *
 * It follows the cursor while leaving half-typed text alone, in the same way
 * the reference box beside it does, and commits the same way the cell editor
 * does: Enter puts it in, Escape puts it back, and clicking away puts it in —
 * because a person who typed something and looked elsewhere meant to type it.
 *
 * While a name is being typed it offers the functions it could become. The
 * list comes from the engine, so it is the functions this program actually
 * has rather than the ones somebody wrote down in an interface once.
 */

export interface FormulaBarProps {
  /** What the active cell holds, as somebody would type it again. */
  text: string
  /** A cell on a sheet nobody can edit is shown and not offered. */
  editable?: boolean
  /**
   * The functions to offer, for a caller that has its own list.
   *
   * The window has none: it asks the engine, which is the only place the
   * list exists. A test has one, which is the whole reason this is a prop.
   */
  functions?: readonly KnownFunction[]
  onCommit: (text: string) => void
}

export function FormulaBar({ text, editable = true, functions, onCommit }: FormulaBarProps) {
  const [typed, setTyped] = useState(text)
  const [followed, setFollowed] = useState(text)
  const [caret, setCaret] = useState(0)
  const [highlighted, setHighlighted] = useState(0)
  const box = useRef<HTMLInputElement>(null)
  /**
   * Whether the box is being left on purpose.
   *
   * Escape has to put the text back and take the focus away, and taking the
   * focus away is what commits — so without this, abandoning an edit would
   * commit the very text it was abandoning. A ref rather than state: it is
   * read in the blur that the same keystroke causes, before any render could
   * have happened.
   */
  const abandoning = useRef(false)

  // Asked for once. The list does not change while the program is running,
  // and asking per keystroke would be a message to Rust per keystroke.
  useEffect(() => {
    void knownFunctions()
  }, [])

  // Adjusted while rendering rather than in an effect: an effect would show
  // the previous cell's contents for a frame and then correct itself, which
  // is a flicker on every arrow key.
  if (followed !== text) {
    setFollowed(text)
    setTyped(text)
  }

  const offer = suggest(typed, caret, functions ?? functionsKnownSoFar())
  const showing = offer?.matches ?? []
  const picked = showing[Math.min(highlighted, showing.length - 1)]

  const take = (name: string) => {
    if (offer === null) return

    const made = chosen(typed, offer, name)
    setTyped(made.text)
    setHighlighted(0)
    // After the render that puts the new text in, or the caret would be set
    // on the old one and the browser would move it back to the end.
    requestAnimationFrame(() => {
      box.current?.setSelectionRange(made.caret, made.caret)
      setCaret(made.caret)
    })
  }

  return (
    <div className="relative flex min-w-0 flex-1 items-center gap-2">
      <span aria-hidden className="select-none font-serif text-xs italic text-muted">
        fx
      </span>
      <input
        ref={box}
        aria-label="Formula bar"
        className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted"
        value={typed}
        readOnly={!editable}
        spellCheck={false}
        placeholder=""
        onChange={(event) => {
          setTyped(event.target.value)
          setCaret(event.target.selectionStart ?? event.target.value.length)
          setHighlighted(0)
        }}
        onSelect={(event) => {
          setCaret(event.currentTarget.selectionStart ?? 0)
        }}
        onBlur={() => {
          if (abandoning.current) {
            abandoning.current = false
            return
          }
          if (typed !== text) onCommit(typed)
        }}
        onKeyDown={(event) => {
          // While the list is open the keys belong to it: Enter chooses a
          // function rather than committing a half-written formula, which is
          // what every spreadsheet does and what the fingers expect.
          if (picked !== undefined) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              const step = event.key === 'ArrowDown' ? 1 : showing.length - 1
              setHighlighted((was) => (was + step) % showing.length)
              return
            }

            if (event.key === 'Enter' || event.key === 'Tab') {
              event.preventDefault()
              take(picked.name)
              return
            }

            if (event.key === 'Escape') {
              event.preventDefault()
              setCaret(-1)
              return
            }
          }

          if (event.key === 'Enter') {
            event.preventDefault()
            event.currentTarget.blur()
            if (typed !== text) onCommit(typed)
            return
          }

          if (event.key === 'Escape') {
            event.preventDefault()
            abandoning.current = true
            setTyped(text)
            event.currentTarget.blur()
          }
        }}
      />

      {picked !== undefined && (
        <SuggestionList
          label="Functions"
          items={showing.map((one) => ({ value: one.name, hint: shape(one) }))}
          highlighted={showing.indexOf(picked)}
          onChoose={take}
          onHighlight={setHighlighted}
          style={{ position: 'absolute', left: 24, top: 28 }}
        />
      )}
    </div>
  )
}
