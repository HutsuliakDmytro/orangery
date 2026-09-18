import { applyChange, compareDecks, readDeck, readPptxPackage } from '@orangery/ooxml-presentation'
import type { Change, Deck } from '@orangery/ooxml-presentation'
import { create } from 'zustand'
import { pickDeckPath, readDeckFile } from './file'
import { useDeckStore } from '../store/deck-store'

/**
 * Reviewing a copy of the deck somebody sent back.
 *
 * A `.pptx` carries no tracked changes the way a `.docx` does, so a review can
 * only be a comparison: PowerPoint's Review ribbon is its Compare feature, and
 * this is the same. There is nothing in the file to accept — there is another
 * file, and differences between the two.
 *
 * The other deck is held in a store of its own rather than beside the open one.
 * It is not a second document being edited: it is the thing being read from,
 * and it goes away when the review ends.
 */

interface ReviewState {
  /** The deck being compared against, or null when no review is running. */
  theirs: Deck | null
  /** What it says differently, in the order a person would go through them. */
  changes: Change[]
  /** The ones already dealt with, by their place in the list. */
  settled: number[]
  start: (theirs: Deck) => void
  end: () => void
  settle: (index: number) => void
}

export const useReviewStore = create<ReviewState>((set) => ({
  theirs: null,
  changes: [],
  settled: [],

  start: (theirs) => {
    const deck = useDeckStore.getState().open?.deck
    set({ theirs, changes: deck === undefined ? [] : compareDecks(deck, theirs), settled: [] })
  },

  end: () => {
    set({ theirs: null, changes: [], settled: [] })
  },

  settle: (index) => {
    set((state) => ({ settled: [...state.settled, index] }))
  },
}))

/** Asks for the other file and starts the review. */
export async function startReview(): Promise<void> {
  const path = await pickDeckPath()
  if (path === null) return

  const theirs = readDeck(await readPptxPackage(await readDeckFile(path)))
  useReviewStore.getState().start(theirs)
}

/**
 * Takes one change into the open deck.
 *
 * The comparison is not made again afterwards. A list that renumbered itself
 * under the pointer would be a list where the next press takes the wrong
 * change, so what is dealt with is marked and what is left is what it was.
 */
export function accept(index: number): void {
  const { theirs, changes } = useReviewStore.getState()
  const change = changes[index]
  if (theirs === null || change === undefined) return

  useDeckStore.getState().editDeck((deck) => applyChange(deck, theirs, change))
  useReviewStore.getState().settle(index)
}

/** Leaves the deck as it is, and says this one has been looked at. */
export function reject(index: number): void {
  useReviewStore.getState().settle(index)
}
