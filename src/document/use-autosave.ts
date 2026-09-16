import { useCurrentEditor } from '@tiptap/react'
import { useEffect, useRef } from 'react'
import { useDocumentStore } from '../store/document-store'
import type { ProseMirrorNodeJson } from '../ooxml/parse-document'
import {
  AUTOSAVE_INTERVAL_MS,
  buildSnapshot,
  clearSnapshot,
  documentKey,
  writeSnapshot,
} from './autosave'

/**
 * Writes a crash-recovery snapshot after five seconds of inactivity.
 *
 * The timer restarts on every change rather than firing on a fixed schedule, so
 * a snapshot is written when the user pauses — not in the middle of a burst of
 * typing, where it would compete with the editor for the main thread.
 */
export function useAutosave(): void {
  const { editor } = useCurrentEditor()
  const dirty = useDocumentStore((state) => state.dirty)
  const path = useDocumentStore((state) => state.path)
  const sessionId = useDocumentStore((state) => state.sessionId)
  const lastSaved = useDocumentStore((state) => state.lastSaved)

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!editor || !dirty) return

    const write = () => {
      void (async () => {
        const key = await documentKey(path ?? sessionId)
        await writeSnapshot(key, buildSnapshot(path, editor.getJSON() as ProseMirrorNodeJson))
      })()
    }

    const restart = () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = setTimeout(write, AUTOSAVE_INTERVAL_MS)
    }

    restart()
    editor.on('update', restart)

    return () => {
      editor.off('update', restart)
      if (timer.current !== null) clearTimeout(timer.current)
    }
  }, [editor, dirty, path, sessionId])

  // A successful save makes the file on disk authoritative, so the snapshot is
  // no longer a recovery candidate and must not be offered on next launch.
  useEffect(() => {
    if (lastSaved === null) return

    void (async () => {
      await clearSnapshot(await documentKey(path ?? sessionId))
    })()
  }, [lastSaved, path, sessionId])
}

/** Marks the store dirty on the first change after a save. */
export function useDirtyTracking(): void {
  const { editor } = useCurrentEditor()
  const markDirty = useDocumentStore((state) => state.markDirty)

  useEffect(() => {
    if (!editor) return

    const onUpdate = () => {
      markDirty()
    }

    editor.on('update', onUpdate)
    return () => {
      editor.off('update', onUpdate)
    }
  }, [editor, markDirty])
}
