import { create } from 'zustand'

/**
 * The slide show: which slide is up, and what the audience is looking at.
 *
 * Its own store rather than a flag on the view, because a show is not a way of
 * looking at the deck — it is a second thing happening to it. The editor keeps
 * whatever slide it was on, so leaving the show puts a person back where they
 * were rather than where the show ended.
 */

interface ShowState {
  /** Null when no show is running. */
  at: number | null
  /**
   * The screen held blank.
   *
   * `B` and `W` are what a presenter presses to take the room's attention off
   * the screen; the show keeps its place underneath and the next key brings it
   * back.
   */
  blank: 'black' | 'white' | null
  /**
   * Digits typed so far, for jumping to a slide by number.
   *
   * PowerPoint takes `12` then Enter. Kept here rather than in the component so
   * that it survives a re-render mid-number.
   */
  typed: string
  /** How many slides there are, so the show knows where the end is. */
  count: number
  /**
   * How many animation steps each slide plays.
   *
   * Here rather than read from the deck on each press: what a press does
   * depends on it, and a store that had to open a slide to answer "what does
   * space do" would be a store that knows less than it needs to.
   */
  steps: number[]
  /**
   * How many of the current slide's steps have been played.
   *
   * Zero is the slide as the room first sees it. Advancing plays the next step
   * and only moves on when there are none left, which is what a press means in
   * every program that has this.
   */
  shown: number
  /**
   * When the show began, for the presenter's timer.
   *
   * A timestamp rather than a running count: a timer that ticks in the store
   * would re-render every window once a second to move one number.
   */
  startedAt: number | null
  /**
   * How long each slide has been up, in milliseconds.
   *
   * Accumulated rather than stamped: a slide gone back to is a slide talked
   * about twice, and the two together are how long it took.
   */
  spent: number[]
  /** When the slide showing came up, for the part not yet added to `spent`. */
  enteredAt: number | null
  /**
   * Whether this run is a rehearsal.
   *
   * Every run is timed — the presenter wants to know how long they have been on
   * this slide either way. Only a rehearsal offers to keep the numbers, because
   * only a rehearsal was started to produce them.
   */
  rehearsing: boolean
  /**
   * How large the notes are drawn in the presenter view, as a multiple.
   *
   * The presenter is the one person reading from further away than anybody, and
   * the size that suits them has nothing to do with the deck.
   */
  notesScale: number
  start: (at: number, count: number, steps?: readonly number[], rehearsing?: boolean) => void
  end: () => void
  go: (to: number) => void
  next: () => void
  previous: () => void
  setBlank: (blank: 'black' | 'white' | null) => void
  scaleNotes: (by: number) => void
  type: (digit: string) => void
  /** Jumps to the number typed so far, if it names a slide. Returns whether it did. */
  jump: () => boolean
  /** The times as they stand, with the slide showing counted up to now. */
  timings: () => number[]
}

/**
 * Adds the time since the slide came up to its total, and restarts the clock.
 *
 * Every way out of a slide goes through this, which is the only way the numbers
 * can be right: a run where one route forgot to stop the clock would blame the
 * time on whatever slide came next.
 */
function counted(state: Pick<ShowState, 'at' | 'spent' | 'enteredAt'>) {
  const now = Date.now()
  if (state.at === null || state.enteredAt === null) return { spent: state.spent, enteredAt: now }

  const spent = [...state.spent]
  spent[state.at] = (spent[state.at] ?? 0) + (now - state.enteredAt)
  return { spent, enteredAt: now }
}

export const useShowStore = create<ShowState>((set, get) => ({
  at: null,
  blank: null,
  typed: '',
  count: 0,
  steps: [],
  shown: 0,
  startedAt: null,
  spent: [],
  enteredAt: null,
  rehearsing: false,
  notesScale: 1,

  start: (at, count, steps = [], rehearsing = false) => {
    const now = Date.now()
    set({
      at: count === 0 ? null : Math.min(Math.max(at, 0), count - 1),
      count,
      steps: [...steps],
      shown: 0,
      blank: null,
      typed: '',
      startedAt: count === 0 ? null : now,
      spent: Array.from({ length: count }, () => 0),
      enteredAt: count === 0 ? null : now,
      rehearsing,
    })
  },

  end: () => {
    // The slide on screen when the show ends counts too; a run that stopped
    // the clock at the last change would lose the whole of the last slide.
    set((state) => ({ ...counted(state), at: null, blank: null, typed: '', shown: 0 }))
  },

  go: (to) => {
    set((state) => {
      if (state.at === null || state.count === 0) return {}
      // Any move puts the screen back: a blanked show that then advanced
      // invisibly would leave the presenter talking about the wrong slide.
      return {
        ...counted(state),
        at: Math.min(Math.max(to, 0), state.count - 1),
        blank: null,
        typed: '',
        // A slide arrived at is a slide not yet animated, whichever way it was
        // arrived at. Going backwards is the exception, and `previous` says so.
        shown: 0,
      }
    })
  },

  next: () => {
    const { at, shown, steps, go } = get()
    if (at === null) return

    // A press plays the next thing on this slide if there is one; the slide is
    // what comes after the last of them.
    if (shown < (steps[at] ?? 0)) {
      set({ shown: shown + 1, blank: null, typed: '' })
      return
    }

    go(at + 1)
  },

  previous: () => {
    const { at, shown, go } = get()
    if (at === null) return

    if (shown > 0) {
      set({ shown: shown - 1, blank: null, typed: '' })
      return
    }

    // Backwards onto a slide that animates lands at its end, not at its start:
    // the room has already seen all of it, and replaying it would be a lie
    // about what was said.
    go(at - 1)
    set((state) => ({ shown: state.at === null ? 0 : (state.steps[state.at] ?? 0) }))
  },

  setBlank: (blank) => {
    set({ blank, typed: '' })
  },

  scaleNotes: (by) => {
    // A quarter either way, between half and four times: below half the notes
    // are unreadable and above four times a sentence is a screenful.
    set((state) => ({ notesScale: Math.min(Math.max(state.notesScale + by, 0.5), 4) }))
  },

  type: (digit) => {
    // Four digits is more slides than anyone brings; the cap keeps a leaned-on
    // key from growing a string forever.
    set((state) => ({ typed: (state.typed + digit).slice(-4) }))
  },

  timings: () => {
    const state = get()
    return counted(state).spent
  },

  jump: () => {
    const { typed, count, go } = get()
    const wanted = Number(typed)
    if (typed === '' || !Number.isFinite(wanted) || wanted < 1 || wanted > count) {
      set({ typed: '' })
      return false
    }

    // People count slides from one.
    go(wanted - 1)
    return true
  },
}))
