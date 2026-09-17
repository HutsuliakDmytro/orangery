import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCurrentEditor } from '@tiptap/react'
import { useEffect } from 'react'
import { fileOperations } from '../editor/commands/file-actions'
import { formatFromPath } from '../document/formats'
import { isTauri } from '../platform/os'
import { useDocumentStore } from '../store/document-store'

/**
 * Documents opened from outside the app: double-click, "Open With", a path on
 * the command line, or a file dropped onto the window.
 *
 * One window holds one document, so opening a second file replaces the current
 * one — and only after the unsaved-changes question has been answered.
 */
export function useExternalOpen(): void {
  const { editor } = useCurrentEditor()

  useEffect(() => {
    if (!editor || !isTauri()) return

    const openFirstSupported = (paths: readonly string[]) => {
      const supported = paths.find((path) => formatFromPath(path) !== null)
      if (supported === undefined) return

      // This window already holds unsaved work, so the incoming file goes to a
      // new window rather than displacing it. Losing the user's edits because
      // they dropped a file on the wrong window is not an acceptable outcome.
      if (useDocumentStore.getState().dirty) {
        void invoke('open_window', { path: supported })
        return
      }

      void fileOperations.open(editor, supported)
    }

    const listeners = [
      listen<string[]>('document:open-path', (event) => {
        openFirstSupported(event.payload)
      }),
      listen<{ paths?: string[] }>('tauri://drag-drop', (event) => {
        openFirstSupported(event.payload.paths ?? [])
      }),
    ]

    return () => {
      for (const listener of listeners) {
        void listener.then((stop) => {
          stop()
        })
      }
    }
  }, [editor])
}
