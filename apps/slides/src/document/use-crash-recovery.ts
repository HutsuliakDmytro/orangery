import { useEffect, useState } from 'react'
import { isTauri } from '@orangery/platform'
import { useDeckStore } from '../store/deck-store'
import { clearSnapshot, listRecoverable, packageFrom, partsOf } from './autosave'
import type { RecoverableSnapshot } from './autosave'
import { nameOf, readDeckFile } from './file'

/**
 * Offers work left behind by a session that did not exit cleanly.
 *
 * A snapshot exists only while a deck has unsaved changes — saving clears it —
 * so anything still on disk at startup means the previous run died mid-edit.
 */
export function useCrashRecovery(): {
  candidates: RecoverableSnapshot[]
  recover: (entry: RecoverableSnapshot) => void
  discard: (entry: RecoverableSnapshot) => void
  discardAll: () => void
} {
  const [candidates, setCandidates] = useState<RecoverableSnapshot[]>([])

  useEffect(() => {
    if (!isTauri()) return
    void (async () => {
      setCandidates(await listRecoverable())
    })()
  }, [])

  /**
   * Removes the offer and the snapshot behind it.
   *
   * The key comes from the listing rather than from the snapshot's path: it is
   * the id of a session that has ended, and nothing in the snapshot records it.
   */
  const forget = (entry: RecoverableSnapshot) => {
    setCandidates((current) => current.filter((candidate) => candidate !== entry))
    void clearSnapshot(entry.key)
  }

  const recover = (entry: RecoverableSnapshot) => {
    const { snapshot } = entry

    void (async () => {
      // A deck that was never saved has no file behind it, so the snapshot is
      // the whole of it: zipped and opened like any other, and it lands back in
      // the editor still belonging to no file.
      if (snapshot.path === null) {
        await useDeckStore.getState().load(await packageFrom(snapshot), null)
        if (useDeckStore.getState().open !== null) {
          useDeckStore.getState().markUnsaved()
          forget(entry)
        }
        return
      }

      // The package still lives in the original file; the snapshot carries only
      // what differed from it, so the file is opened and the difference applied.
      try {
        await useDeckStore.getState().load(await readDeckFile(snapshot.path), snapshot.path)
      } catch {
        useDeckStore.setState({
          error: `${nameOf(snapshot.path)} is no longer where it was, so the unsaved changes to it cannot be put back.`,
        })
        return
      }

      // `load` reports a file it could not read by setting `error` and leaving
      // whatever was open in place. Applying the snapshot then would patch the
      // wrong deck, so the deck that answered has to be the one asked for.
      if (useDeckStore.getState().open?.path !== snapshot.path) return

      useDeckStore.getState().restore(partsOf(snapshot))

      // The recovered work belongs to this session now, which writes its own
      // snapshot. Leaving the old one would offer the same work at every
      // launch, however many times it was recovered.
      forget(entry)
    })()
  }

  const discardAll = () => {
    for (const entry of candidates) forget(entry)
  }

  return { candidates, recover, discard: forget, discardAll }
}
