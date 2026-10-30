import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { useCurrentEditor } from '@tiptap/react'
import type { Editor } from '@tiptap/react'
import { useEffect } from 'react'
import { useLaunchRequests } from '@orangery/ui-kit'
import { fileOperations } from '../editor/commands/file-actions'
import { formatFromPath } from '../document/formats'
import { isTauri } from '@orangery/platform'
import { useDocumentStore } from '../store/document-store'

/**
 * Documents opened from outside the app.
 *
 * Two ways in, and they are not the same thing. A double-click in Finder,
 * "Open With" or a path in `argv` is the operating system asking: it reaches
 * `packages/tauri-shared/src/launch.rs` first, which decides which window it
 * belongs in, and arrives here through `useLaunchRequests` already addressed.
 * A file dropped on the window is the person pointing at this window, and is
 * handled here.
 */
export function useExternalOpen(): void {
  const { editor } = useCurrentEditor()
  const path = useDocumentStore((state) => state.path)
  const dirty = useDocumentStore((state) => state.dirty)

  useLaunchRequests({
    ready: editor !== null,
    vacant: path === null && !dirty,
    open: (target) => (editor === null ? Promise.resolve(null) : openForLaunch(editor, target)),
  })

  useEffect(() => {
    if (!editor || !isTauri()) return

    const openDropped = (paths: readonly string[]) => {
      const supported = paths.find((one) => formatFromPath(one) !== null)
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

    const stop = listen<{ paths?: string[] }>('tauri://drag-drop', (event) => {
      openDropped(event.payload.paths ?? [])
    })

    return () => {
      void stop.then((unlisten) => {
        unlisten()
      })
    }
  }, [editor])
}

/**
 * Opens a file the operating system asked for, and says whether it worked.
 *
 * `fileOperations.open` reports a failure as a warning on the banner and
 * carries on, which is right for the Open dialog and wrong here: the window
 * would show the banner over a welcome screen and the person would read it as
 * the double-click having been ignored. So the warning is taken back off the
 * banner and said once, in the window's own place, by the launch screen.
 */
async function openForLaunch(editor: Editor, target: string): Promise<string | null> {
  const before = useDocumentStore.getState().warnings

  await fileOperations.open(editor, target)

  const after = useDocumentStore.getState().warnings
  const failure = after.slice(before.length).find((warning) => warning.tag === 'file')
  if (failure === undefined) return null

  useDocumentStore.setState({ warnings: before })

  // The launch screen names the file already; the banner's sentence did too.
  const name = target.split(/[\\/]/u).pop() ?? target
  return failure.message.replace(`Opening ${name} failed: `, '')
}
