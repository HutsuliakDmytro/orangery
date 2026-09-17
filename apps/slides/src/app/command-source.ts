import { useMemo } from 'react'
import type { CommandSource } from '@orangery/ui-kit'
import { useViewStore } from '../store/view-store'

/**
 * What a Slides command acts on, and when to ask again.
 *
 * Nothing yet — the context is empty until there is a deck to put in it, which
 * is phase 1. What already matters is the second half: the view commands are
 * toggles, and without a notification their checkmarks in the menu would show
 * the state the app started with.
 *
 * `CommandContext` is deliberately not augmented here. An app declares what its
 * commands touch; claiming a deck before one exists would be a type that lies.
 */
export function useCommandSource(): CommandSource {
  return useMemo(
    () => ({
      read: () => ({}),
      subscribe: (listener) => useViewStore.subscribe(listener),
    }),
    [],
  )
}
