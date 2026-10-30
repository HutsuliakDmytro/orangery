import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { isTauri } from '@orangery/platform'
import { fileNameOf, useLaunchRequests } from '@orangery/ui-kit'
import { openDeck, openInNewWindow } from '../document/file-operations'
import { insertPictureOnSlide } from '../document/insert-picture'
import { nameOf, readFileBytes } from '../document/file'
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
/** Puts every picture among the dropped files onto the current slide. */
async function dropPictures(paths: readonly string[]): Promise<void> {
  if (useDeckStore.getState().open === null) return

  for (const path of paths) {
    if (!/\.(png|jpe?g|gif|bmp|webp)$/iu.test(path)) continue
    insertPictureOnSlide(nameOf(path), await readFileBytes(path))
  }
}

export function useExternalOpen(): void {
  const open = useDeckStore((state) => state.open)

  // A double-click, "Open With", a path in `argv`: the operating system
  // asking. Rust has already chosen this window for it — one with no deck in
  // it — so it opens here, in place.
  useLaunchRequests({ ready: true, vacant: open === null, open: openForLaunch })

  useEffect(() => {
    if (!isTauri()) return

    const openDropped = (paths: readonly string[]) => {
      // A picture dropped on an open deck is a picture for the slide, not a
      // file to open. Decks are looked for first: dropping a deck while one is
      // open means "open this", whatever else came with it.
      const deck = paths.find((path) => /\.(pptx|odp)$/iu.test(path))
      if (deck === undefined) {
        void dropPictures(paths)
        return
      }

      if (!useDeckStore.getState().saved) {
        void openInNewWindow(deck)
        return
      }

      void openDeck(deck)
    }

    const stop = listen<{ paths?: string[] }>('tauri://drag-drop', (event) => {
      openDropped(event.payload.paths ?? [])
    })

    return () => {
      void stop.then((unlisten) => {
        unlisten()
      })
    }
  }, [])
}

/**
 * Opens a deck the operating system asked for, and says whether it worked.
 *
 * Three ways it can fail, and before this only one of them was shown: the
 * deck store puts a file it cannot parse on the canvas, but a file it cannot
 * read threw past it, and a file that is not a presentation at all — "Open
 * With" will offer anything — was read as one. All three now come back as a
 * sentence, said once by the launch screen.
 */
async function openForLaunch(path: string): Promise<string | null> {
  if (!/\.(pptx|odp)$/iu.test(path)) {
    return `Orangery Slides opens PowerPoint (.pptx) and OpenDocument (.odp) presentations, and ${fileNameOf(path)} is neither.`
  }

  await openDeck(path)

  const { open, error } = useDeckStore.getState()
  if (error !== null) {
    useDeckStore.setState({ error: null })
    return error
  }
  return open === null ? 'It could not be read as a presentation.' : null
}
