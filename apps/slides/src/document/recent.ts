import { useEffect } from 'react'
import type { RecentFile } from '@orangery/platform'
import { refreshRecent, useRecentStore } from '../store/recent-store'
import { openDeck } from './file-operations'
import { whenSafe } from './unsaved'

/** The recent list, read off disk once and kept current by opening decks. */
export function useRecentDecks(): RecentFile[] {
  const files = useRecentStore((state) => state.files)

  useEffect(() => {
    void refreshRecent()
  }, [])

  return files
}

/** Opening a recent deck is opening a deck: the same question comes first. */
export function openRecent(path: string): void {
  whenSafe(() => openDeck(path))
}
