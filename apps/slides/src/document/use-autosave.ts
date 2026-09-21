import { useEffect, useRef } from 'react'
import { useDeckStore } from '../store/deck-store'
import {
  AUTOSAVE_INTERVAL_MS,
  buildSnapshot,
  clearSnapshot,
  documentKey,
  writeSnapshot,
} from './autosave'

/**
 * Writes a crash-recovery snapshot after five seconds without a change.
 *
 * The timer restarts on every change rather than firing on a schedule, so the
 * snapshot is written when the person pauses — not in the middle of dragging a
 * shape, where building it would compete with the canvas for the main thread.
 */
export function useAutosave(): void {
  const open = useDeckStore((state) => state.open)
  const saved = useDeckStore((state) => state.saved)
  const revision = useDeckStore((state) => state.revision)
  const sessionId = useDeckStore((state) => state.sessionId)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (open === null) return

    // A deck that matches its file has nothing worth recovering, and the
    // snapshot from before the save must not outlive it: left on disk, it would
    // be offered at the next launch as work that was never lost.
    if (saved) {
      void (async () => {
        await clearSnapshot(await documentKey(sessionId))
      })()
      return
    }

    timer.current = setTimeout(() => {
      void (async () => {
        // Read again rather than close over what the effect saw: five seconds
        // is long enough for the deck to have been closed underneath.
        const state = useDeckStore.getState()
        if (state.open === null) return

        await writeSnapshot(
          await documentKey(state.sessionId),
          buildSnapshot(state.open.path, state.open.package, state.dirtyParts),
        )
      })()
    }, AUTOSAVE_INTERVAL_MS)

    return () => {
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [open, saved, revision, sessionId])
}
