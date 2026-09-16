import { useCurrentEditor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { isTauri } from '../platform/os'
import { useDocumentStore } from '../store/document-store'
import { clearSnapshot, documentKey, listRecoverable } from './autosave'
import type { Snapshot } from './autosave'
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
  candidates: Snapshot[]
  recover: (snapshot: Snapshot) => void
  discard: (snapshot: Snapshot) => void
  discardAll: () => void
} {
  const { editor } = useCurrentEditor()
  const [candidates, setCandidates] = useState<Snapshot[]>([])

  useEffect(() => {
    if (!isTauri()) return
    void (async () => {
      setCandidates(await listRecoverable())
    })()
  }, [])

  const forget = (snapshot: Snapshot) => {
    setCandidates((current) => current.filter((entry) => entry !== snapshot))
    void (async () => {
      await clearSnapshot(await documentKey(snapshot.path ?? ''))
    })()
  }

  const recover = (snapshot: Snapshot) => {
    if (!editor) return

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

      setCandidates((current) => current.filter((entry) => entry !== snapshot))
    })()
  }

  const discardAll = () => {
    for (const snapshot of candidates) forget(snapshot)
  }

  return { candidates, recover, discard: forget, discardAll }
}
