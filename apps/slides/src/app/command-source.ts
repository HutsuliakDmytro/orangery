import { useMemo } from 'react'
import type { CommandSource } from '@orangery/ui-kit'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * What a Slides command acts on, and when to ask again.
 *
 * Nothing yet — the context is empty until there is a deck to put in it, which
 * is phase 1. What already matters is the second half: a command says whether
 * it can be run by reading a store, so everything it might read has to be
 * something this notifies on. The view store alone was not: half the commands
 * ask the deck store whether a deck is open, and a menu bar told only about
 * the view store kept saying nothing was.
 *
 * `CommandContext` is deliberately not augmented here. An app declares what its
 * commands touch; claiming a deck before one exists would be a type that lies.
 */
export function useCommandSource(): CommandSource {
  return useMemo(
    () => ({
      read: () => ({}),
      subscribe: (listener) => {
        const stopWatchingTheView = useViewStore.subscribe(listener)
        const stopWatchingTheDeck = useDeckStore.subscribe(listener)

        return () => {
          stopWatchingTheView()
          stopWatchingTheDeck()
        }
      },
    }),
    [],
  )
}
