import { create } from 'zustand'

/**
 * What an import could not bring across.
 *
 * Its own store rather than part of the deck's warnings, because it is not a
 * fact about the deck: the deck is fine, and what is missing is missing from
 * the file it was made out of. Cleared when another deck arrives, so it never
 * describes something that is no longer on screen.
 */

interface ImportState {
  note: string | null
  set: (note: string | null) => void
}

export const useImportStore = create<ImportState>((set) => ({
  note: null,
  set: (note) => {
    set({ note })
  },
}))
