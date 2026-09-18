import { useEffect, useState } from 'react'
import { loadEmbeddedFonts } from './embedded-fonts'
import { useDeckStore } from '../store/deck-store'

/**
 * Registers the deck's own fonts while it is open, and takes them back out
 * again when it is not.
 *
 * Taking them out matters as much as putting them in: the faces go into the
 * document, not into the deck, so a second deck asking for the same typeface at
 * a different weight would otherwise be drawn in the first one's.
 *
 * What comes back is the list the engine refused, which the banner says out
 * loud. A font that did not load is a deck that will break its lines somewhere
 * else — the one thing embedding was meant to prevent, and worth knowing about
 * before the projector.
 */
export function useEmbeddedFonts(): string[] {
  const pkg = useDeckStore((state) => state.open?.package)
  const [refused, setRefused] = useState<string[]>([])

  useEffect(() => {
    if (pkg === undefined) return

    let dropped: (() => void) | null = null
    let gone = false

    void loadEmbeddedFonts(pkg).then((fonts) => {
      // The deck may have been closed while the faces were being parsed, and
      // registering them then would leave them in the document for good.
      if (gone) {
        fonts.release()
        return
      }
      dropped = fonts.release
      setRefused(fonts.refused)
    })

    return () => {
      gone = true
      dropped?.()
      // Cleared on the way out rather than on the way in: a deck being closed
      // is the moment its fonts stop being anybody's problem.
      setRefused([])
    }
  }, [pkg])

  return refused
}
