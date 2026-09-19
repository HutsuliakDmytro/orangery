import {
  applyChange,
  applySlideChange,
  compareDecks,
  isShapeChange,
  readDeck,
  readPptxPackage,
} from '@orangery/ooxml-presentation'
import type { Change, Deck } from '@orangery/ooxml-presentation'
import type { OoxmlPackage } from '@orangery/ooxml-core'
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
 *
 * Their package is kept beside their deck, because a change about a whole slide
 * is taken from the package and not from the model: the slide brings its
 * layout, its pictures and the parts that hold them, and none of those are in
 * the shape tree.
 */

interface ReviewState {
  /** The deck being compared against, or null when no review is running. */
  theirs: Deck | null
  /** The package it was read from, which a whole slide has to be copied out of. */
  theirPackage: OoxmlPackage | null
  /** What it says differently, in the order a person would go through them. */
  changes: Change[]
  /** The ones already dealt with, by their place in the list. */
  settled: number[]
  start: (theirs: Deck, theirPackage: OoxmlPackage) => void
  end: () => void
  settle: (index: number) => void
}

export const useReviewStore = create<ReviewState>((set) => ({
  theirs: null,
  theirPackage: null,
  changes: [],
  settled: [],

  start: (theirs, theirPackage) => {
    const deck = useDeckStore.getState().open?.deck
    set({
      theirs,
      theirPackage,
      changes: deck === undefined ? [] : compareDecks(deck, theirs),
      settled: [],
    })
  },

  end: () => {
    set({ theirs: null, theirPackage: null, changes: [], settled: [] })
  },

  settle: (index) => {
    set((state) => ({ settled: [...state.settled, index] }))
  },
}))

/** Asks for the other file and starts the review. */
export async function startReview(): Promise<void> {
  const path = await pickDeckPath()
  if (path === null) return

  const pkg = await readPptxPackage(await readDeckFile(path))
  useReviewStore.getState().start(readDeck(pkg), pkg)
}

/**
 * Takes one change into the open deck.
 *
 * Two different edits, because a change is about one of two things. A shape
 * lives in the slide's tree, so taking it is a change to the deck; a slide is a
 * part of the package with its own relationships and its own place in the
 * order, so taking that is a change to the package.
 *
 * The comparison is not made again afterwards. A list that renumbered itself
 * under the pointer would be a list where the next press takes the wrong
 * change, so what is dealt with is marked and what is left is what it was.
 */
export function accept(index: number): void {
  const { theirs, theirPackage, changes } = useReviewStore.getState()
  const change = changes[index]
  if (theirs === null || theirPackage === null || change === undefined) return

  if (isShapeChange(change)) {
    useDeckStore.getState().editDeck((deck) => applyChange(deck, theirs, change))
  } else {
    useDeckStore
      .getState()
      .editPackage((open) => applySlideChange(open.package, theirPackage, change))
  }

  useReviewStore.getState().settle(index)
}

/** Leaves the deck as it is, and says this one has been looked at. */
export function reject(index: number): void {
  useReviewStore.getState().settle(index)
}
