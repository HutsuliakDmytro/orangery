import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCurrentEditor } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { clearSnapshot, snapshotKey } from '../document/autosave'
import { fileOperations } from '../editor/commands/file-actions'
import { isTauri } from '../platform/os'
import { useDocumentStore } from '../store/document-store'

/**
 * Intercepts window close while there are unsaved changes.
 *
 * Rust vetoes the close and emits an event; this decides what to ask. A clean
 * document closes immediately — prompting on every close is the behaviour users
 * learn to click through without reading.
 */
export function useCloseGuard(): { prompting: boolean; resolve: (choice: CloseChoice) => void } {
  const { editor } = useCurrentEditor()
  const [prompting, setPrompting] = useState(false)

  useEffect(() => {
    if (!isTauri()) return

    const unlisten = listen('window:close-requested', () => {
      if (!useDocumentStore.getState().dirty) {
        void invoke('confirm_close')
        return
      }
      setPrompting(true)
    })

    return () => {
      void unlisten.then((stop) => {
        stop()
      })
    }
  }, [])

  const resolve = (choice: CloseChoice) => {
    setPrompting(false)

    if (choice === 'cancel') return

    if (choice === 'discard') {
      void (async () => {
        // The user chose to throw this work away. Leaving the snapshot would
        // offer it back as unrecovered at the next launch, which is the
        // opposite of what they just said.
        await clearSnapshot(await snapshotKey(useDocumentStore.getState().sessionId))
        await invoke('confirm_close')
      })()
      return
    }

    if (!editor) return
    void (async () => {
      await fileOperations.save(editor)
      // Only close if the save actually landed; a cancelled Save As leaves the
      // document dirty, and closing then would lose the work.
      if (!useDocumentStore.getState().dirty) await invoke('confirm_close')
    })()
  }

  return { prompting, resolve }
}

export type CloseChoice = 'save' | 'discard' | 'cancel'
