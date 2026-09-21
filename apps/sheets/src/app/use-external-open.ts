import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { isTauri } from '@orangery/platform'
import { openWorkbookAt } from '../document/file'

/**
 * Workbooks arriving from outside the app: a double-click in the file manager,
 * "Open With", a path on the command line, or a file dropped on the window.
 *
 * One window holds one workbook, so an incoming file takes the place of the one
 * on screen. Nothing is lost by that yet — nothing here edits — and the moment
 * it can be, this grows the same guard the other two apps have.
 */
export function useExternalOpen(): void {
  useEffect(() => {
    if (!isTauri()) return

    const openFirst = (paths: readonly string[]) => {
      const workbook = paths.find((path) => /\.(xlsx|xlsm|ods)$/iu.test(path))
      if (workbook !== undefined) void openWorkbookAt(workbook)
    }

    const listeners = [
      listen<string[]>('document:open-path', (event) => {
        openFirst(event.payload)
      }),
      listen<{ paths?: string[] }>('tauri://drag-drop', (event) => {
        openFirst(event.payload.paths ?? [])
      }),
    ]

    return () => {
      for (const listener of listeners) {
        void listener.then((stop) => {
          stop()
        })
      }
    }
  }, [])
}
