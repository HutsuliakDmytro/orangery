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
   * When the show began, for the presenter's timer.
   *
   * A timestamp rather than a running count: a timer that ticks in the store
   * would re-render every window once a second to move one number.
   */
  startedAt: number | null
  /**
   * How large the notes are drawn in the presenter view, as a multiple.
   *
   * The presenter is the one person reading from further away than anybody, and
   * the size that suits them has nothing to do with the deck.
   */
  notesScale: number
  start: (at: number, count: number) => void
  end: () => void
  go: (to: number) => void
  next: () => void
  previous: () => void
  setBlank: (blank: 'black' | 'white' | null) => void
  scaleNotes: (by: number) => void
  type: (digit: string) => void
  /** Jumps to the number typed so far, if it names a slide. Returns whether it did. */
  jump: () => boolean
}

export const useShowStore = create<ShowState>((set, get) => ({
  at: null,
  blank: null,
  typed: '',
  count: 0,
  startedAt: null,
  notesScale: 1,

  start: (at, count) => {
    set({
      at: count === 0 ? null : Math.min(Math.max(at, 0), count - 1),
      count,
      blank: null,
      typed: '',
      startedAt: count === 0 ? null : Date.now(),
    })
  },

  end: () => {
    set({ at: null, blank: null, typed: '', startedAt: null })
  },

  go: (to) => {
    set((state) => {
      if (state.at === null || state.count === 0) return {}
      // Any move puts the screen back: a blanked show that then advanced
      // invisibly would leave the presenter talking about the wrong slide.
      return { at: Math.min(Math.max(to, 0), state.count - 1), blank: null, typed: '' }
    })
  },

  next: () => {
    const { at, go } = get()
    if (at !== null) go(at + 1)
  },

  previous: () => {
    const { at, go } = get()
    if (at !== null) go(at - 1)
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
