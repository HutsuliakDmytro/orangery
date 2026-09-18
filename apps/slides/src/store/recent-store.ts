import { create } from 'zustand'
import { loadRecentFiles, rememberRecent } from '@orangery/platform'
import type { RecentFile } from '@orangery/platform'

/**
 * The decks offered under Recent.
 *
 * Held in a store rather than re-read whenever something looks like it might
 * have changed. The list is written by opening a deck, and the path it writes
 * is the path that is already on screen — so a component watching the deck for
 * a reason to re-read would read a moment too early, every time, and show the
 * list without the deck that had just been opened.
 *
 * Nothing here reaches back into the file operations, which is what lets those
 * record a deck without the two importing each other.
 */

interface RecentState {
  files: RecentFile[]
  set: (files: RecentFile[]) => void
}

export const useRecentStore = create<RecentState>((set) => ({
  files: [],
  set: (files) => {
    set({ files })
  },
}))

/** Reads what previous runs left behind. */
export async function refreshRecent(): Promise<void> {
  useRecentStore.getState().set(await loadRecentFiles())
}

/** Records a deck as the most recently opened, and shows it straight away. */
export async function noteRecent(path: string): Promise<void> {
  useRecentStore.getState().set(await rememberRecent(path))
}
