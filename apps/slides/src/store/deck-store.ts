import { create } from 'zustand'
import { readDeck, readPptxPackage, readThemes } from '@orangery/ooxml-presentation'
import type { Deck } from '@orangery/ooxml-presentation'
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

interface DeckState {
  open: OpenDeck | null
  /** Index into `deck.slides`, or -1 when there is nothing to show. */
  current: number
  /** What went wrong opening the last file, for the banner. */
  error: string | null
  load: (bytes: Uint8Array, path: string | null) => Promise<void>
  select: (index: number) => void
  close: () => void
}

export const useDeckStore = create<DeckState>((set) => ({
  open: null,
  current: -1,
  error: null,

  load: async (bytes, path) => {
    try {
      const pkg = await readPptxPackage(bytes)
      const deck = readDeck(pkg)

      set({
        open: { package: pkg, deck, themes: readThemes(pkg, deck), path },
        current: deck.slides.length > 0 ? 0 : -1,
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
      return { current: count === 0 ? -1 : Math.min(Math.max(index, 0), count - 1) }
    })
  },

  close: () => {
    set({ open: null, current: -1, error: null })
  },
}))

/** The slide being shown, or null when no deck is open. */
export function currentSlide(state: DeckState) {
  const slides = state.open?.deck.slides ?? []
  return state.current < 0 ? null : (slides[state.current] ?? null)
}
