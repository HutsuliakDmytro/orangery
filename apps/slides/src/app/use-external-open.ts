import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { isTauri } from '@orangery/platform'
import { openDeck, openInNewWindow } from '../document/file-operations'
import { useDeckStore } from '../store/deck-store'

/**
 * Decks arriving from outside the app: a double-click, "Open With", a path on
 * the command line, or a file dropped onto the window.
 *
 * One window holds one deck, so an incoming file takes the place of the one on
 * screen — unless that one has unsaved changes, in which case it gets a window
 * of its own instead. A dropped file is not a request to throw anything away,
 * and now that there can be a second window there is nothing to ask about:
 * dropping on the wrong window is a slip of the hand, and the answer to a slip
 * is to make it cost nothing.
 */
export function useExternalOpen(): void {
  useEffect(() => {
    if (!isTauri()) return

    const openFirstDeck = (paths: readonly string[]) => {
      // Several files can be dropped at once, and only decks mean anything
      // here. The first one wins rather than all of them: there is one window.
      const deck = paths.find((path) => /\.pptx$/iu.test(path))
      if (deck === undefined) return

      if (!useDeckStore.getState().saved) {
        void openInNewWindow(deck)
        return
      }

      void openDeck(deck)
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
