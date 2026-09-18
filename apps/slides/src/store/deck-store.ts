import { create } from 'zustand'
import { readDeck, readPptxPackage, readThemes, writeSlidePart } from '@orangery/ooxml-presentation'
import type { Deck, Slide, SlidePart } from '@orangery/ooxml-presentation'
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
 * One undoable change, as the text of every part it touched.
 *
 * The unit is the part rather than the model because an edit mutates the parsed
 * XML in place — that is what preserves everything we do not model (ADR 0002),
 * and it means there is no immutable model to keep older versions of. A slide
 * part is a few kilobytes, so keeping a hundred of them costs less than the
 * machinery for anything cleverer.
 *
 * A step holds several parts because some actions are not about one slide:
 * replacing a word across the deck is one thing a person did and has to be one
 * thing they can take back.
 */
interface Edit {
  parts: { path: string; before: string; after: string }[]
}

/** What a hundred steps of history costs before the oldest is dropped. */
const HISTORY_LIMIT = 200

interface DeckState {
  open: OpenDeck | null
  /** Index into `deck.slides`, or -1 when there is nothing to show. */
  current: number
  /**
   * The layout or master being edited, by part path, or null in the ordinary
   * view.
   *
   * A layout and a master are the same thing as a slide structurally — a part
   * holding a shape tree — so editing one is the same operation on a different
   * part rather than a second editor. What changes is only which part the
   * canvas is pointed at.
   */
  master: string | null
  /** Shape ids selected on the current slide. */
  selection: number[]
  /**
   * The slides picked out in the filmstrip, `current` always among them.
   *
   * Separate from `current` because they answer different questions: one slide
   * is being shown and edited, and any number of them can be the subject of an
   * action on slides. Collapsing the two would mean deleting four slides had to
   * decide which one had been on screen.
   */
  slideSelection: number[]
  /** The shape whose text is being edited, or null. */
  editing: number | null
  undoStack: Edit[]
  redoStack: Edit[]
  /** What went wrong opening the last file, for the banner. */
  error: string | null
  load: (bytes: Uint8Array, path: string | null) => Promise<void>
  select: (index: number) => void
  /** Picks out slides in the filmstrip; the last one given becomes current. */
  selectSlides: (indexes: readonly number[]) => void
  /** Shows a layout or master for editing; null goes back to the slides. */
  showMaster: (path: string | null) => void
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
  /** The same, for a change that may touch any number of slides. */
  editDeck: (change: (deck: Deck) => boolean) => void
  /**
   * A change to the deck itself — a slide added, moved or removed.
   *
   * Recorded differently because the presentation part and the new slide part
   * are not slides the writer walks: the whole package before and after is
   * compared instead, which is heavier and is the only thing that catches a
   * part appearing.
   */
  editPackage: (change: (open: OpenDeck) => boolean) => void
  undo: () => void
  redo: () => void
}

/** Re-reads the deck from a package that has just been written to. */
function reread(open: OpenDeck): OpenDeck {
  const deck = readDeck(open.package)
  return { ...open, deck, themes: readThemes(open.package, deck) }
}

/**
 * Keeps the shown slide and the filmstrip selection inside a deck that changed
 * size — deleting four slides or undoing the add of one both leave indexes
 * pointing past the end otherwise.
 */
function withinDeck(open: OpenDeck, current: number, picked: readonly number[]) {
  const count = open.deck.slides.length
  const shown = count === 0 ? -1 : Math.min(Math.max(current, 0), count - 1)
  const within = picked.filter((index) => index >= 0 && index < count)

  if (within.length > 0) return { current: shown, slideSelection: within }
  return { current: shown, slideSelection: shown === -1 ? [] : [shown] }
}

export const useDeckStore = create<DeckState>((set, get) => ({
  open: null,
  current: -1,
  master: null,
  selection: [],
  slideSelection: [],
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
        master: null,
        selection: [],
        slideSelection: deck.slides.length > 0 ? [0] : [],
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
        // Picking a slide is how you leave the master view; there is no second
        // way out to forget about.
        master: null,
        // Selection belongs to a slide, so moving away drops it rather than
        // carrying ids that mean something else on the slide arrived at.
        selection: [],
        slideSelection: count === 0 ? [] : [Math.min(Math.max(index, 0), count - 1)],
        editing: null,
      }
    })
  },

  selectSlides: (indexes) => {
    set((state) => {
      const count = state.open?.deck.slides.length ?? 0
      const within = [...new Set(indexes)].filter((index) => index >= 0 && index < count)
      const last = within.at(-1)
      if (last === undefined) return {}

      return {
        current: last,
        master: null,
        selection: [],
        slideSelection: [...within].sort((first, second) => first - second),
        editing: null,
      }
    })
  },

  showMaster: (path) => {
    set({ master: path, selection: [], editing: null })
  },

  close: () => {
    set({
      open: null,
      current: -1,
      master: null,
      selection: [],
      slideSelection: [],
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
    const { editDeck } = get()
    const part = currentSlide(get())
    if (part === null) return

    editDeck((deck) => {
      const here = shapeParts(deck).find((one) => one.path === part.path)
      return here === undefined ? false : change(asSlide(here))
    })
  },

  editDeck: (change) => {
    const { open } = get()
    if (open === null) return

    // Layouts and masters as well as slides: they hold a shape tree too, and a
    // change that reached one of them and was not written back would be a
    // change the file never saw.
    const touched = shapeParts(open.deck)
    const before = new Map(
      touched.map((part) => [part.path, getPartText(open.package, part.path) ?? '']),
    )
    if (!change(open.deck)) return

    for (const part of touched) writeSlidePart(open.package, part)

    // Only the parts that actually differ are recorded: writing every part back
    // is how the change is applied, not a claim that all of them changed.
    const parts = touched.flatMap((part) => {
      const after = getPartText(open.package, part.path) ?? ''
      const original = before.get(part.path) ?? ''
      return after === original ? [] : [{ path: part.path, before: original, after }]
    })
    if (parts.length === 0) return

    set((state) => ({
      open: reread(open),
      undoStack: [...state.undoStack, { parts }].slice(-HISTORY_LIMIT),
      // A new change is a new branch; what was undone is no longer reachable.
      redoStack: [],
    }))
  },

  editPackage: (change) => {
    const { open } = get()
    if (open === null) return

    const before = new Map([...open.package.parts].map(([path, part]) => [path, part.text ?? '']))
    if (!change(open)) return

    const parts = [...open.package.parts].flatMap(([path, part]) => {
      const after = part.text ?? ''
      const original = before.get(path)
      // A part that did not exist before has no `before` to restore to, so an
      // empty string stands for "it was not there" — reopening the deck reads
      // the slide list, and a part nothing points at is not a slide.
      return after === original ? [] : [{ path, before: original ?? '', after }]
    })
    if (parts.length === 0) return

    set((state) => {
      const reopened = reread(open)
      return {
        open: reopened,
        ...withinDeck(reopened, state.current, state.slideSelection),
        undoStack: [...state.undoStack, { parts }].slice(-HISTORY_LIMIT),
        redoStack: [],
      }
    })
  },

  undo: () => {
    const { open, undoStack } = get()
    const step = undoStack[undoStack.length - 1]
    if (open === null || step === undefined) return

    for (const part of step.parts) setPartText(open.package, part.path, part.before)
    set((state) => {
      const reopened = reread(open)
      return {
        open: reopened,
        ...withinDeck(reopened, state.current, state.slideSelection),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, step],
      }
    })
  },

  redo: () => {
    const { open, redoStack } = get()
    const step = redoStack[redoStack.length - 1]
    if (open === null || step === undefined) return

    for (const part of step.parts) setPartText(open.package, part.path, part.after)
    set((state) => {
      const reopened = reread(open)
      return {
        open: reopened,
        ...withinDeck(reopened, state.current, state.slideSelection),
        undoStack: [...state.undoStack, step],
        redoStack: state.redoStack.slice(0, -1),
      }
    })
  },
}))

/** The slide being shown, or null when no deck is open. */
/**
 * A layout or master seen as a slide, the same object every time.
 *
 * This is a selector's return value, so a fresh object each call would be a
 * fresh reference each render and the component would never stop rendering.
 * The parts themselves are replaced whenever the deck is re-read, which is
 * exactly when the widened view should be replaced too — so they are the key.
 */
const widened = new WeakMap<SlidePart, Slide>()

function asSlide(part: SlidePart): Slide {
  // A slide is already one; widening it would blank the layout it points at.
  if ('notes' in part) return part as Slide

  const existing = widened.get(part)
  if (existing !== undefined) return existing

  // A layout has no layout of its own and no notes; that is the whole of the
  // difference, and everything that draws or edits a shape tree ignores it.
  const made: Slide = { ...part, layout: null, notes: null }
  widened.set(part, made)
  return made
}

/** Every part of a deck that holds a shape tree, in the order they are edited. */
function shapeParts(deck: Deck): SlidePart[] {
  return [...deck.slides, ...deck.layouts.values(), ...deck.masters.values()]
}

/**
 * The part on the canvas: a slide, or the layout or master being edited.
 *
 * A layout has no layout of its own and no notes, which is the only way it
 * differs from a slide here; everything that draws or edits a shape tree works
 * on it unchanged, which is the whole reason master editing is not a second
 * editor.
 */
export function currentSlide(state: DeckState): Slide | null {
  const deck = state.open?.deck
  if (deck === undefined) return null

  if (state.master !== null) {
    const part = deck.layouts.get(state.master) ?? deck.masters.get(state.master) ?? null
    return part === null ? null : asSlide(part)
  }

  return state.current < 0 ? null : (deck.slides[state.current] ?? null)
}
