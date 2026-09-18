import { create } from 'zustand'
import {
  ensureTextBody,
  flatten,
  readDeck,
  readPptxPackage,
  readSlidePart,
  readThemes,
  writeSlidePart,
} from '@orangery/ooxml-presentation'
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

/** A part as a crash snapshot carries it: XML as text, media as bytes. */
export interface RestoredPart {
  path: string
  text?: string
  bytes?: Uint8Array
}

function newSessionId(): string {
  return `session-${Math.random().toString(36).slice(2, 10)}`
}

/**
 * Every part's text, by reference.
 *
 * Costs nothing to take — the strings are not copied — and comparing the result
 * afterwards is how we find out what a change actually touched. Binary parts
 * map to undefined, so a part that appears is told apart by its key being
 * absent rather than by its value.
 */
function partTexts(pkg: OoxmlPackage): Map<string, string | undefined> {
  return new Map([...pkg.parts].map(([path, part]) => [path, part.text]))
}

/** Paths that differ from a map taken before a change, additions included. */
function changedSince(before: Map<string, string | undefined>, pkg: OoxmlPackage): string[] {
  const changed: string[] = []
  for (const [path, part] of pkg.parts) {
    if (!before.has(path) || before.get(path) !== part.text) changed.push(path)
  }
  return changed
}

/**
 * Folds what a change touched into what was already dirty.
 *
 * Only additions, never removals: nothing takes a part out of the package.
 * Deleting a slide drops its entry from `presentation.xml` and leaves the part
 * itself orphaned, which is what saving already writes, so the change to the
 * presentation part describes the deletion in full. Should a part ever start
 * being deleted outright, a snapshot would have to carry that as its own fact —
 * recovery replays onto the original file, which still has it.
 */
function withChanges(state: Pick<DeckState, 'dirtyParts'>, changed: readonly string[]) {
  const dirty = new Set(state.dirtyParts)
  for (const path of changed) dirty.add(path)
  return { dirtyParts: dirty }
}

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
  /**
   * The group the pointer is considered to be inside, or null at the top.
   *
   * A group is one thing until you go into it: clicking a member selects the
   * whole group, and a double click steps inside, where the next click picks a
   * member out. Groups nest, so this is a position in a chain rather than a
   * flag, and `Escape` walks back out one level at a time.
   */
  openGroup: number | null
  /**
   * The picture whose crop is being dragged, or null.
   *
   * Its own state rather than a mode on the selection, because cropping is
   * entered and left the way text is: a double click in, `Escape` out. What a
   * handle means while it is set is "show less of this side", and the same
   * handle means "make the frame bigger" the moment it is not.
   */
  cropping: number | null
  /**
   * The shape whose outline points are being dragged, or null.
   *
   * Beside cropping rather than folded into it: both turn the handles into
   * something other than sizing, and both are left with `Escape`, but a picture
   * has no points and a drawn shape has no crop.
   */
  editingPoints: number | null
  /**
   * The block of cells picked out in a table, or null.
   *
   * Carries the table's id as well as the coordinates: a cell is only a cell of
   * something, and the same row and column mean a different square in the next
   * table along.
   */
  cells: { table: number; row: number; column: number; toRow: number; toColumn: number } | null
  undoStack: Edit[]
  redoStack: Edit[]
  /** What went wrong opening the last file, for the banner. */
  error: string | null
  /**
   * This editing session, for the autosave directory.
   *
   * Keyed by the session and never by the path: Save As would otherwise write
   * the snapshot under the old key and clear it under the new one, leaving the
   * old one on disk to be offered as recoverable at every launch.
   */
  sessionId: string
  /**
   * Parts of the package that differ from the file on disk.
   *
   * What the crash snapshot is made of. Tracked here rather than worked out
   * later because it cannot be: the package is mutated in place, so by the time
   * anyone asks, the version that was on disk is gone.
   *
   * Not the same as the undo history. Inserting a picture adds a media part and
   * rewrites a relationship file, neither of which is a step anyone takes back,
   * and both of which a recovered deck needs — without them the slide points at
   * an image that is not there.
   */
  dirtyParts: ReadonlySet<string>
  /**
   * Bumped by every recorded change.
   *
   * The autosave timer restarts on it. `dirtyParts` cannot serve: editing the
   * same slide twice changes nothing about which parts are dirty, and the
   * second edit would never be snapshotted.
   */
  revision: number
  /**
   * Whether what is on screen is what is in the file.
   *
   * Set by every change and cleared by a save. Undo clears it too: a deck
   * saved and then undone differs from its file again, and saying otherwise
   * would lose the undo the next time the window closed.
   */
  saved: boolean
  /** Records that the deck now matches a file, and where that file is. */
  markSaved: (path: string) => void
  /**
   * Says the deck differs from any file, without any part having changed.
   *
   * For a recovered deck that never had a file: `load` leaves it looking saved,
   * because loading is what opening a file does, and a deck that claims to be
   * in a file it is not in is one the window will let go of without a word.
   */
  markUnsaved: () => void
  /**
   * Puts recovered parts back onto a freshly opened deck.
   *
   * Called after `load` has reopened the original file: a snapshot is a patch
   * on that file, not a deck of its own, so it can only be applied to one.
   */
  restore: (parts: readonly RestoredPart[]) => void
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
  /** Steps into a group, or back out to the top with null. */
  setOpenGroup: (id: number | null) => void
  /** Enters crop on a picture, or leaves it with null. */
  setCropping: (id: number | null) => void
  /** Enters point editing on a shape, or leaves it with null. */
  setEditingPoints: (id: number | null) => void
  /** Picks a cell out of a table; `extend` grows the block from where it was. */
  pickCell: (table: number, at: { row: number; column: number }, extend: boolean) => void
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
 * Re-reads only the parts that were written to.
 *
 * Re-reading the whole deck is correct and costs the whole deck: three hundred
 * slides parsed again because one shape moved a point to the left. At that size
 * it is the difference between an edit you feel and one you do not, and it is
 * paid on every keystroke — so the narrow path is not an optimisation of a
 * measurement, it is the difference between the app working and not.
 *
 * Falls back to the whole deck whenever the answer could be wrong: a part that
 * will not parse, or a change that added or removed one. Getting this wrong
 * shows up as a slide that stops updating, which is worse than slow.
 */
function rereadParts(open: OpenDeck, paths: readonly string[]): OpenDeck {
  const fresh = new Map<string, SlidePart>()

  for (const path of paths) {
    const part = readSlidePart(open.package, path)
    if (part === null) return reread(open)
    fresh.set(path, part)
  }

  const swap = <T extends SlidePart>(part: T): T => {
    const replacement = fresh.get(part.path)
    return replacement === undefined ? part : { ...part, ...replacement }
  }

  return {
    ...open,
    deck: {
      ...open.deck,
      slides: open.deck.slides.map(swap),
      layouts: new Map([...open.deck.layouts].map(([path, part]) => [path, swap(part)])),
      masters: new Map([...open.deck.masters].map(([path, part]) => [path, swap(part)])),
    },
  }
}

/**
 * Whether a set of changed parts is one the narrow path can handle.
 *
 * Only parts the deck already knows about: anything else means the shape of the
 * deck changed — a slide added, a picture's media arriving — and the model has
 * to be built again from the package rather than patched.
 */
function knownParts(open: OpenDeck, paths: readonly string[]): boolean {
  return paths.every(
    (path) =>
      open.deck.layouts.has(path) ||
      open.deck.masters.has(path) ||
      open.deck.slides.some((slide) => slide.path === path),
  )
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
  openGroup: null,
  cropping: null,
  editingPoints: null,
  cells: null,
  undoStack: [],
  redoStack: [],
  error: null,
  sessionId: newSessionId(),
  dirtyParts: new Set<string>(),
  revision: 0,
  saved: true,

  markSaved: (path) => {
    set((state) => ({
      open: state.open === null ? null : { ...state.open, path },
      saved: true,
      // The file on disk is the deck again, so nothing is left to recover and
      // the next snapshot starts from nothing.
      dirtyParts: new Set<string>(),
    }))
  },

  markUnsaved: () => {
    set((state) => ({ saved: false, revision: state.revision + 1 }))
  },

  restore: (parts) => {
    const { open } = get()
    if (open === null) return

    for (const part of parts) {
      if (part.text !== undefined) {
        setPartText(open.package, part.path, part.text)
      } else if (part.bytes !== undefined) {
        // Media, which has no text to set: kept byte for byte, and given a
        // fresh date because the one it had belonged to a zip entry that was
        // never written.
        open.package.parts.set(part.path, {
          path: part.path,
          bytes: part.bytes,
          date: new Date(),
        })
      }
    }

    set((state) => {
      const reopened = reread(open)
      return {
        open: reopened,
        ...withinDeck(reopened, state.current, state.slideSelection),
        // Recovered work is by definition not in any file yet, and the parts it
        // touched are exactly the ones the next snapshot has to carry.
        saved: false,
        dirtyParts: new Set(parts.map((part) => part.path)),
        revision: state.revision + 1,
        // History belonged to the session that died; what is here now is a
        // starting point, not a step.
        undoStack: [],
        redoStack: [],
      }
    })
  },

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
        openGroup: null,
        cropping: null,
        editingPoints: null,
        cells: null,
        undoStack: [],
        redoStack: [],
        error: null,
        sessionId: newSessionId(),
        dirtyParts: new Set<string>(),
        revision: 0,
        saved: true,
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
        // The group belonged to the slide being left, and its id means
        // something else on the slide arrived at.
        openGroup: null,
        cropping: null,
        editingPoints: null,
        cells: null,
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
        openGroup: null,
        cropping: null,
        editingPoints: null,
        cells: null,
      }
    })
  },

  showMaster: (path) => {
    set({ master: path, selection: [], editing: null, openGroup: null })
  },

  close: () => {
    set({
      open: null,
      current: -1,
      master: null,
      selection: [],
      slideSelection: [],
      editing: null,
      openGroup: null,
      cropping: null,
      editingPoints: null,
      cells: null,
      undoStack: [],
      redoStack: [],
      error: null,
      sessionId: newSessionId(),
      dirtyParts: new Set<string>(),
      revision: 0,
      saved: true,
    })
  },

  selectShapes: (ids, add = false) => {
    set((state) => ({
      selection: add ? [...new Set([...state.selection, ...ids])] : [...ids],
    }))
  },

  setOpenGroup: (id) => {
    set({ openGroup: id })
  },

  setEditingPoints: (id) => {
    set({ editingPoints: id, ...(id === null ? {} : { selection: [id], editing: null }) })
  },

  setCropping: (id) => {
    set({ cropping: id, ...(id === null ? {} : { selection: [id], editing: null }) })
  },

  pickCell: (table, at, extend) => {
    set((state) => {
      const held = state.cells
      // Extending from somewhere else is not extending; it is starting again
      // where the pointer is.
      if (!extend || held === null || held.table !== table) {
        return {
          cells: { table, row: at.row, column: at.column, toRow: at.row, toColumn: at.column },
        }
      }
      return { cells: { ...held, toRow: at.row, toColumn: at.column } }
    })
  },

  setEditing: (id) => {
    // A shape drawn elsewhere may state no text body at all, and entering it
    // has to make one first. Here rather than in the canvas because there is
    // more than one way in — a double click, a command, the outline — and the
    // one that was not wired up is the one that loses what was typed.
    if (id !== null) {
      get().edit((slide) => {
        const shape = flatten(slide.shapes).find((one) => one.id === id)
        return shape === undefined ? false : ensureTextBody(shape)
      })
    }

    set({ editing: id, ...(id === null ? {} : { selection: [id] }) })
  },

  edit: (change) => {
    const { open } = get()
    const part = currentSlide(get())
    if (open === null || part === null) return

    const before = getPartText(open.package, part.path) ?? ''
    const texts = partTexts(open.package)
    if (!change(part)) return

    // One part written, not every part in the deck. `editDeck` rewrites them
    // all because a change given the whole deck may have touched any of them;
    // a change given one slide cannot have.
    writeSlidePart(open.package, part)
    const after = getPartText(open.package, part.path) ?? ''

    const changed = changedSince(texts, open.package)
    if (after === before && changed.length === 0) return

    const parts = after === before ? [] : [{ path: part.path, before, after }]

    set((state) => ({
      // A change that reached beyond the deck's own parts — media arriving with
      // a picture — has changed the shape of the package, and the model has to
      // be built from it rather than patched.
      open: knownParts(open, changed) ? rereadParts(open, changed) : reread(open),
      undoStack:
        parts.length === 0
          ? state.undoStack
          : [...state.undoStack, { parts }].slice(-HISTORY_LIMIT),
      redoStack: parts.length === 0 ? state.redoStack : [],
      saved: false,
      ...withChanges(state, changed),
      revision: state.revision + 1,
    }))
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
    // The whole package as well as the shape parts: a change can reach further
    // than the tree it was aimed at — inserting a picture also writes a
    // relationship file and a media part — and a snapshot that missed those
    // would recover a slide pointing at an image that is not there.
    const texts = partTexts(open.package)
    if (!change(open.deck)) return

    for (const part of touched) writeSlidePart(open.package, part)

    // Only the parts that actually differ are recorded: writing every part back
    // is how the change is applied, not a claim that all of them changed.
    const parts = touched.flatMap((part) => {
      const after = getPartText(open.package, part.path) ?? ''
      const original = before.get(part.path) ?? ''
      return after === original ? [] : [{ path: part.path, before: original, after }]
    })

    const changed = changedSince(texts, open.package)
    if (parts.length === 0 && changed.length === 0) return

    set((state) => ({
      open: reread(open),
      // An undoable step only when something undoable happened. Media arriving
      // beside a shape is not a step of its own, and pushing an empty one would
      // make Undo do nothing once for every picture.
      undoStack:
        parts.length === 0
          ? state.undoStack
          : [...state.undoStack, { parts }].slice(-HISTORY_LIMIT),
      // A new change is a new branch; what was undone is no longer reachable.
      redoStack: parts.length === 0 ? state.redoStack : [],
      saved: false,
      ...withChanges(state, changed),
      revision: state.revision + 1,
    }))
  },

  editPackage: (change) => {
    const { open } = get()
    if (open === null) return

    const before = new Map([...open.package.parts].map(([path, part]) => [path, part.text ?? '']))
    const texts = partTexts(open.package)
    if (!change(open)) return

    const parts = [...open.package.parts].flatMap(([path, part]) => {
      const after = part.text ?? ''
      const original = before.get(path)
      // A part that did not exist before has no `before` to restore to, so an
      // empty string stands for "it was not there" — reopening the deck reads
      // the slide list, and a part nothing points at is not a slide.
      return after === original ? [] : [{ path, before: original ?? '', after }]
    })

    const changed = changedSince(texts, open.package)
    if (parts.length === 0 && changed.length === 0) return

    set((state) => {
      const reopened = reread(open)
      return {
        open: reopened,
        ...withinDeck(reopened, state.current, state.slideSelection),
        undoStack:
          parts.length === 0
            ? state.undoStack
            : [...state.undoStack, { parts }].slice(-HISTORY_LIMIT),
        redoStack: parts.length === 0 ? state.redoStack : [],
        saved: false,
        ...withChanges(state, changed),
        revision: state.revision + 1,
      }
    })
  },

  undo: () => {
    const { open, undoStack } = get()
    const step = undoStack[undoStack.length - 1]
    if (open === null || step === undefined) return

    const texts = partTexts(open.package)
    for (const part of step.parts) setPartText(open.package, part.path, part.before)
    const touched = step.parts.map((part) => part.path)
    set((state) => {
      const reopened = knownParts(open, touched) ? rereadParts(open, touched) : reread(open)
      return {
        open: reopened,
        ...withinDeck(reopened, state.current, state.slideSelection),
        undoStack: state.undoStack.slice(0, -1),
        redoStack: [...state.redoStack, step],
        saved: false,
        // Undoing is a change like any other as far as the file is concerned:
        // a deck saved and then undone differs from its file again.
        ...withChanges(state, changedSince(texts, open.package)),
        revision: state.revision + 1,
      }
    })
  },

  redo: () => {
    const { open, redoStack } = get()
    const step = redoStack[redoStack.length - 1]
    if (open === null || step === undefined) return

    const texts = partTexts(open.package)
    for (const part of step.parts) setPartText(open.package, part.path, part.after)
    const touched = step.parts.map((part) => part.path)
    set((state) => {
      const reopened = knownParts(open, touched) ? rereadParts(open, touched) : reread(open)
      return {
        open: reopened,
        ...withinDeck(reopened, state.current, state.slideSelection),
        undoStack: [...state.undoStack, step],
        redoStack: state.redoStack.slice(0, -1),
        saved: false,
        ...withChanges(state, changedSince(texts, open.package)),
        revision: state.revision + 1,
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
