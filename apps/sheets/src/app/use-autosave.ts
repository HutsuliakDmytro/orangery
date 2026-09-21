import { useEffect, useRef } from 'react'
import { workbookBytes } from '../document/save'
import {
  AUTOSAVE_INTERVAL_MS,
  buildSnapshot,
  clearSnapshot,
  snapshotKey,
  writeSnapshot,
} from '../document/autosave'
import { useWorkbookStore } from '../store/workbook-store'

/**
 * Keeps a copy of the workbook where a crash cannot reach it.
 *
 * On a timer rather than on every edit: the snapshot is the whole package, and
 * rebuilding a zip on each keystroke would be felt. Only when something has
 * been typed, so a workbook somebody is reading costs nothing at all.
 *
 * The snapshot is cleared when the workbook is saved or closed, because a
 * directory that is still there is exactly how the next launch knows something
 * ended badly.
 */
export function useAutosave(): void {
  const open = useWorkbookStore((state) => state.open)
  const path = useWorkbookStore((state) => state.path)
  const edited = useWorkbookStore((state) => state.edited)
  const session = useWorkbookStore((state) => state.session)

  /** Whether a snapshot is being written, so a slow one is not started twice. */
  const writing = useRef(false)

  useEffect(() => {
    if (open === null || !edited) return

    const timer = setInterval(() => {
      if (writing.current) return
      writing.current = true

      void (async () => {
        try {
          const key = await snapshotKey(session)
          await writeSnapshot(key, buildSnapshot(path, await workbookBytes(open)))
        } catch {
          // A snapshot that could not be written is not worth interrupting
          // somebody over: the workbook itself is untouched, and the next
          // interval will try again.
        } finally {
          writing.current = false
        }
      })()
    }, AUTOSAVE_INTERVAL_MS)

    return () => {
      clearInterval(timer)
    }
  }, [edited, open, path, session])

  // Saved or closed: there is nothing left to recover, and a snapshot left
  // behind would be offered at the next launch as if something had gone wrong.
  useEffect(() => {
    if (open !== null && edited) return

    void (async () => {
      try {
        await clearSnapshot(await snapshotKey(session))
      } catch {
        // Nothing to say: the directory is a cache.
      }
    })()
  }, [edited, open, session])
}
