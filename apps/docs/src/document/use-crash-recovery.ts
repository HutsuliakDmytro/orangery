import { useCurrentEditor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { isTauri } from '@orangery/platform'
import { useDocumentStore } from '../store/document-store'
import { clearSnapshot, listRecoverable } from './autosave'
import type { RecoverableSnapshot } from './autosave'
import { openDocumentFrom } from './file-operations'
import { getSession, setSession } from './session'
import { createDocument } from './file-operations'

/**
 * Offers unsaved work left behind by a session that did not exit cleanly.
 *
 * A snapshot exists only while a document has unsaved changes — saving clears it
 * — so anything still on disk at startup means the previous run died mid-edit.
 */
export function useCrashRecovery(): {
  candidates: RecoverableSnapshot[]
  recover: (entry: RecoverableSnapshot) => void
  discard: (entry: RecoverableSnapshot) => void
  discardAll: () => void
} {
  const { editor } = useCurrentEditor()
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
   * The key comes from the listing rather than from the snapshot's path: a
   * document that was never saved has no path, and deriving a key from one that
   * does would point at a directory that was never written.
   */
  const forget = (entry: RecoverableSnapshot) => {
    setCandidates((current) => current.filter((candidate) => candidate !== entry))
    void clearSnapshot(entry.key)
  }

  const recover = (entry: RecoverableSnapshot) => {
    if (!editor) return
    const { snapshot } = entry

    void (async () => {
      // The package still lives in the original file; the snapshot only carries
      // the edited text, so the file is reopened and the text replayed onto it.
      if (snapshot.path !== null) {
        try {
          const opened = await openDocumentFrom(snapshot.path)
          setSession(opened.session)
          useDocumentStore.getState().openDocument({
            path: opened.path,
            format: opened.format,
            warnings: opened.warnings,
          })
        } catch {
          // The file moved or was deleted since the crash. The text is still
          // worth recovering, into a new document.
          setSession({ kind: 'docx', docx: await createDocument() })
          useDocumentStore.getState().newDocument()
        }
      } else if (getSession() === null) {
        setSession({ kind: 'docx', docx: await createDocument() })
      }

      editor.commands.setContent(snapshot.doc)
      // Recovered content differs from whatever is on disk, so it is unsaved.
      useDocumentStore.getState().markDirty()

      // The recovered text now belongs to this session, which writes its own
      // snapshot. Leaving the old one would offer the same work again at every
      // launch, however many times it was recovered.
      forget(entry)
    })()
  }

  const discardAll = () => {
    for (const entry of candidates) forget(entry)
  }

  return { candidates, recover, discard: forget, discardAll }
}
