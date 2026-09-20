import { useRef, useState } from 'react'

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
 */

export interface FormulaBarProps {
  /** What the active cell holds, as somebody would type it again. */
  text: string
  /** A cell on a sheet nobody can edit is shown and not offered. */
  editable?: boolean
  onCommit: (text: string) => void
}

export function FormulaBar({ text, editable = true, onCommit }: FormulaBarProps) {
  const [typed, setTyped] = useState(text)
  const [followed, setFollowed] = useState(text)
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

  // Adjusted while rendering rather than in an effect: an effect would show
  // the previous cell's contents for a frame and then correct itself, which
  // is a flicker on every arrow key.
  if (followed !== text) {
    setFollowed(text)
    setTyped(text)
  }

  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      <span aria-hidden className="select-none font-serif text-xs italic text-muted">
        fx
      </span>
      <input
        aria-label="Formula bar"
        className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none placeholder:text-muted"
        value={typed}
        readOnly={!editable}
        spellCheck={false}
        placeholder=""
        onChange={(event) => {
          setTyped(event.target.value)
        }}
        onBlur={() => {
          if (abandoning.current) {
            abandoning.current = false
            return
          }
          if (typed !== text) onCommit(typed)
        }}
        onKeyDown={(event) => {
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
    </div>
  )
}
