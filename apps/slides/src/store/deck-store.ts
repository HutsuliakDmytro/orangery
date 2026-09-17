import { create } from 'zustand'
import { readDeck, readPptxPackage, readThemes, writeSlidePart } from '@orangery/ooxml-presentation'
import type { Deck, Slide } from '@orangery/ooxml-presentation'
import { getPartText, setPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import type { Theme } from '@orangery/ooxml-drawingml'

/**
 * The deck currently open.
 *
 * The package is held beside the model because saving writes the package back,
 * not the model — only the parts that were edited are regenerated
 * (`docs/adr/0002-pptx-roundtrip.md`).
 */

export interface OpenDeck {
  package: OoxmlPackage
  deck: Deck
  themes: Map<string, Theme>
  /** Null for a deck that has never been saved. */
  path: string | null
}

/**
 * One undoable change, as the text of the part before and after it.
 *
 * The unit is the part rather than the model because an edit mutates the parsed
 * XML in place — that is what preserves everything we do not model (ADR 0002),
 * and it means there is no immutable model to keep older versions of. A slide
 * part is a few kilobytes, so keeping a hundred of them costs less than the
 * machinery for anything cleverer.
 */
interface Edit {
  part: string
  before: string
  after: string
}

/** What a hundred steps of history costs before the oldest is dropped. */
const HISTORY_LIMIT = 200

interface DeckState {
  open: OpenDeck | null
  /** Index into `deck.slides`, or -1 when there is nothing to show. */
  current: number
  /** Shape ids selected on the current slide. */
  selection: number[]
  /** The shape whose text is being edited, or null. */
  editing: number | null
  undoStack: Edit[]
  redoStack: Edit[]
  /** What went wrong opening the last file, for the banner. */
  error: string | null
  load: (bytes: Uint8Array, path: string | null) => Promise<void>
  select: (index: number) => void
  close: () => void
  /** Selects shapes on the current slide; `add` extends rather than replaces. */
  selectShapes: (ids: readonly number[], add?: boolean) => void
  /** Enters a shape's text, or leaves whatever was being edited. */
  setEditing: (id: number | null) => void
  /**
   * Runs a change against the current slide and records it.
   *
   * The change edits the parsed XML; this writes the part back, re-reads the
   * deck so the model matches the file, and pushes the pair onto the history.
   * A change that returns false is one that had nothing to do, and leaves no
   * step behind.
   */
  edit: (change: (slide: Slide) => boolean) => void
  undo: () => void
  redo: () => void
}

/** Re-reads the deck from a package that has just been written to. */
function reread(open: OpenDeck): OpenDeck {
  const deck = readDeck(open.package)
  return { ...open, deck, themes: readThemes(open.package, deck) }
}

export const useDeckStore = create<DeckState>((set, get) => ({
  open: null,
  current: -1,
  selection: [],
  editing: null,
  undoStack: [],
  redoStack: [],
  error: null,

  load: async (bytes, path) => {
    try {
      const pkg = await readPptxPackage(bytes)
      const deck = readDeck(pkg)

      set({
        open: { package: pkg, deck, themes: readThemes(pkg, deck), path },
        current: deck.slides.length > 0 ? 0 : -1,
        selection: [],
        editing: null,
        undoStack: [],
        redoStack: [],
        error: null,
      })
    } catch (cause) {
      // Shown rather than thrown: a file that will not open is an answer, and
      // the app has to keep whatever was open before.
      set({ error: cause instanceof Error ? cause.message : 'could not read the presentation' })
    }
  },

  select: (index) => {
    set((state) => {
      const count = state.open?.deck.slides.length ?? 0
      return {
        current: count === 0 ? -1 : Math.min(Math.max(index, 0), count - 1),
        // Selection belongs to a slide, so moving away drops it rather than
        // carrying ids that mean something else on the slide arrived at.
        selection: [],
        editing: null,
      }
    })
  },

  close: () => {
    set({
      open: null,
      current: -1,
      selection: [],
      editing: null,
      undoStack: [],
      redoStack: [],
      error: null,
    })
  },

  selectShapes: (ids, add = false) => {
    set((state) => ({
      selection: add ? [...new Set([...state.selection, ...ids])] : [...ids],
    }))
  },

  setEditing: (id) => {
    set({ editing: id, ...(id === null ? {} : { selection: [id] }) })
  },

  edit: (change) => {
    const { open, current } = get()
    const slide = open?.deck.slides[current]
    if (open === null || slide === undefined) return

    const before = getPartText(open.package, slide.path) ?? ''
    if (!change(slide)) return

    writeSlidePart(open.package, slide)
    const after = getPartText(open.package, slide.path) ?? ''
    if (after === before) return

    set((state) => ({
      open: reread(open),
      undoStack: [...state.undoStack, { part: slide.path, before, after }].slice(-HISTORY_LIMIT),
      // A new change is a new branch; what was undone is no longer reachable.
      redoStack: [],
    }))
  },

  undo: () => {
    const { open, undoStack } = get()
    const step = undoStack[undoStack.length - 1]
    if (open === null || step === undefined) return

    setPartText(open.package, step.part, step.before)
    set((state) => ({
      open: reread(open),
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, step],
    }))
  },

  redo: () => {
    const { open, redoStack } = get()
    const step = redoStack[redoStack.length - 1]
    if (open === null || step === undefined) return

    setPartText(open.package, step.part, step.after)
    set((state) => ({
      open: reread(open),
      undoStack: [...state.undoStack, step],
      redoStack: state.redoStack.slice(0, -1),
    }))
  },
}))

/** The slide being shown, or null when no deck is open. */
export function currentSlide(state: DeckState) {
  const slides = state.open?.deck.slides ?? []
  return state.current < 0 ? null : (slides[state.current] ?? null)
}
