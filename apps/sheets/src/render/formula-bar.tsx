import { useEffect, useRef, useState } from 'react'
import { cycledReference, referencesIn } from '@orangery/ooxml-spreadsheet'
import { colorOfReference } from './reference-colors'
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
  /**
   * What is in the box while somebody is in it, and null once they leave.
   *
   * So that the sheet can box the cells a formula names while it is being
   * written here rather than in a cell. The grid already says what is in its
   * own editor; this is the same news from the other box.
   */
  onTyping?: (text: string | null) => void
}

export function FormulaBar({
  text,
  editable = true,
  functions,
  onCommit,
  onTyping,
}: FormulaBarProps) {
  const [typed, setTyped] = useState(text)
  const [followed, setFollowed] = useState(text)
  const [caret, setCaret] = useState(0)
  const [highlighted, setHighlighted] = useState(0)
  const box = useRef<HTMLInputElement>(null)
  const mirror = useRef<HTMLDivElement>(null)
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

  /**
   * Whether anything is being drawn behind the input.
   *
   * Only a formula has references to colour, and the mirror exists for one
   * reason: to put colours behind an input that has been made transparent.
   * Drawn behind an input that has not been, it is a second copy of the same
   * words a fraction of a line from the first — which is what every cell
   * holding text looked like in the formula bar, struck through by itself.
   */
  const isFormula = typed.startsWith('=')

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
      <div className="relative min-w-0 flex-1">
        {/*
          The references, in the colours the sheet boxes them in.

          A mirror behind a transparent input rather than a rich editor: an
          `<input>` cannot hold colours, and the alternative — a
          contenteditable — would mean owning selection, undo and every
          keystroke of text editing to change the colour of five characters.
          The two are kept in step by being the same text in the same font at
          the same scroll.
        */}
        {isFormula && (
          <div
            ref={mirror}
            aria-hidden
            className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre font-mono text-xs leading-[inherit]"
          >
            {colored(typed)}
          </div>
        )}
        <input
          ref={box}
          aria-label="Formula bar"
          className="relative min-w-0 w-full bg-transparent font-mono text-xs outline-none placeholder:text-muted"
          style={{
            color: isFormula ? 'transparent' : undefined,
            caretColor: 'currentColor',
          }}
          onScroll={(event) => {
            if (mirror.current !== null) mirror.current.scrollLeft = event.currentTarget.scrollLeft
          }}
          value={typed}
          readOnly={!editable}
          spellCheck={false}
          placeholder=""
          onChange={(event) => {
            setTyped(event.target.value)
            setCaret(event.target.selectionStart ?? event.target.value.length)
            setHighlighted(0)
            onTyping?.(event.target.value)
          }}
          onFocus={() => {
            onTyping?.(typed)
          }}
          onSelect={(event) => {
            setCaret(event.currentTarget.selectionStart ?? 0)
          }}
          onBlur={() => {
            onTyping?.(null)
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

            // `A1` → `$A$1` → `A$1` → `$A1`, on the reference under the
            // caret. It goes no further when the caret is not in one, because
            // F4 elsewhere in the system means something else.
            if (event.key === 'F4') {
              const at = event.currentTarget.selectionStart ?? typed.length
              const moved = cycledReference(typed, at)
              if (moved === null) return

              event.preventDefault()
              setTyped(moved.text)
              setCaret(moved.caret)
              onTyping?.(moved.text)
              // After the render that has the new text in it: setting the
              // selection on the old value would put the caret back.
              queueMicrotask(() => {
                box.current?.setSelectionRange(moved.caret, moved.caret)
              })
              return
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
      </div>

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

/**
 * The text with its references in the colours the sheet uses for them.
 *
 * Only a formula: `Northampton` typed into a cell is a town, and colouring
 * the `A1` a reader can find inside a word would be colouring something that
 * is not there.
 */
function colored(text: string): React.ReactNode {
  if (!text.startsWith('=')) return text

  const found = referencesIn(text)
  if (found.length === 0) return text

  const parts: React.ReactNode[] = []
  let at = 0

  for (const [index, one] of found.entries()) {
    parts.push(text.slice(at, one.start))
    parts.push(
      <span
        key={`${String(one.start)}:${String(one.end)}`}
        style={{ color: colorOfReference(index) }}
      >
        {text.slice(one.start, one.end)}
      </span>,
    )
    at = one.end
  }

  parts.push(text.slice(at))
  return parts
}
