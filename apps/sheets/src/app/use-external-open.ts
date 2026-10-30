import { listen } from '@tauri-apps/api/event'
import { useEffect } from 'react'
import { isTauri } from '@orangery/platform'
import { fileNameOf, useLaunchRequests } from '@orangery/ui-kit'
import { openWorkbookAt } from '../document/file'
import { useWorkbookStore } from '../store/workbook-store'

const WORKBOOK = /\.(xlsx|xlsm|ods)$/iu

/**
 * Workbooks arriving from outside the app.
 *
 * A double-click in the file manager, "Open With" or a path in `argv` is the
 * operating system asking: it reaches `packages/tauri-shared/src/launch.rs`
 * first, which picks a window with no workbook in it — or makes one — and it
 * arrives here through `useLaunchRequests` to be opened in place. A file
 * dropped on the window is handled below, and takes the place of the one on
 * screen: nothing is lost by that yet, because nothing here edits, and the
 * moment it can be, this grows the same guard the other two apps have.
 */
export function useExternalOpen(): void {
  const open = useWorkbookStore((state) => state.open)

  useLaunchRequests({ ready: true, vacant: open === null, open: openForLaunch })

  useEffect(() => {
    if (!isTauri()) return

    const stop = listen<{ paths?: string[] }>('tauri://drag-drop', (event) => {
      const workbook = (event.payload.paths ?? []).find((path) => WORKBOOK.test(path))
      if (workbook !== undefined) void openWorkbookAt(workbook)
    })

    return () => {
      void stop.then((unlisten) => {
        unlisten()
      })
    }
  }, [])
}

/**
 * Opens a workbook the operating system asked for, and says whether it worked.
 *
 * `openWorkbookAt` puts a failure on the strip above the grid, which is where
 * it belongs for the Open dialog. Here the grid is the welcome screen, and a
 * strip over a welcome screen reads as the double-click being ignored, so the
 * sentence is taken off the strip and said once, in the window's own place.
 */
async function openForLaunch(path: string): Promise<string | null> {
  if (!WORKBOOK.test(path)) {
    return `Orangery Sheets opens Excel (.xlsx, .xlsm) and OpenDocument (.ods) workbooks, and ${fileNameOf(path)} is neither.`
  }

  if (await openWorkbookAt(path)) return null

  const { problem } = useWorkbookStore.getState()
  useWorkbookStore.setState({ problem: null })
  return problem ?? 'It could not be read as a workbook.'
}
