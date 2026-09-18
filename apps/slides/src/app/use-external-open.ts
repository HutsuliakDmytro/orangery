import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { isTauri } from '@orangery/platform'
import { openDeck } from '../document/file-operations'
import { whenSafe } from '../document/unsaved'

/**
 * Decks arriving from outside the app: a double-click, "Open With", a path on
 * the command line, or a file dropped onto the window.
 *
 * One window holds one deck, so an incoming file replaces the one on screen —
 * and only after the unsaved-changes question has been answered. Dropping a
 * file on the wrong window is a slip, and a slip must not cost an hour's work.
 */
export function useExternalOpen(): void {
  useEffect(() => {
    if (!isTauri()) return

    const openFirstDeck = (paths: readonly string[]) => {
      // Several files can be dropped at once, and only decks mean anything
      // here. The first one wins rather than all of them: there is one window.
      const deck = paths.find((path) => /\.pptx$/iu.test(path))
      if (deck === undefined) return

      whenSafe(() => openDeck(deck))
    }

    const listeners = [
      listen<string[]>('document:open-path', (event) => {
        openFirstDeck(event.payload)
      }),
      listen<{ paths?: string[] }>('tauri://drag-drop', (event) => {
        openFirstDeck(event.payload.paths ?? [])
      }),
    ]

    return () => {
      for (const listener of listeners) {
        void listener.then((stop) => {
          stop()
        })
      }
    }
  }, [])
}
