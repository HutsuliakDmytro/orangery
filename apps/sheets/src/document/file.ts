import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { baseName, isTauri } from '@orangery/platform'
import { useWorkbookStore } from '../store/workbook-store'
import { saveWorkbookTo } from './save'

/**
 * Getting a workbook off the disk.
 *
 * Reading goes through Rust rather than the webview: it is the same command
 * the other two apps use, from `@orangery/tauri-shared`, and writing will have
 * to be atomic with a backup, which a webview cannot do.
 */

interface LoadedFile {
  bytes: number[]
  path: string
  modifiedMs: number | null
}

export async function pickWorkbookPath(): Promise<string | null> {
  if (!isTauri()) return null

  const selected = await openDialog({
    multiple: false,
    directory: false,
    // OpenDocument as well: it is not the native format, but somebody with a
    // `.ods` in front of them is trying to open a spreadsheet.
    filters: [{ name: 'Workbook', extensions: ['xlsx', 'xlsm', 'ods'] }],
  })

  return typeof selected === 'string' ? selected : null
}

export async function readWorkbookFile(path: string): Promise<Uint8Array> {
  const loaded = await invoke<LoadedFile>('read_document', { path })
  return new Uint8Array(loaded.bytes)
}

/** The file name, for the window title. Re-exported so callers need one import. */
export const nameOf = baseName

/**
 * Opens a workbook by path, which is what every way in comes down to.
 *
 * The dialog, the file association, a drop on the window: all of them end up
 * here with a path, and the failure they share — a file that is not a workbook
 * — is reported once rather than in each of them.
 */
export async function openWorkbookAt(path: string): Promise<boolean> {
  try {
    const bytes = await readWorkbookFile(path)
    await useWorkbookStore.getState().load(bytes, path)
    return true
  } catch (error) {
    useWorkbookStore
      .getState()
      .fail(error instanceof Error ? error.message : `Could not open ${baseName(path)}.`)
    return false
  }
}

/** The dialog, and then the file it chose. */
export async function openWorkbookFromDialog(): Promise<boolean> {
  const path = await pickWorkbookPath()
  return path === null ? false : openWorkbookAt(path)
}

/**
 * Writes the workbook back where it came from.
 *
 * A workbook opened from a path saves to that path; one that came from
 * nowhere — which nothing can produce yet — is asked about. The failure is
 * reported the same way an open's is, because it is the same kind of news.
 */
export async function saveWorkbook(): Promise<boolean> {
  const { open, path, edited } = useWorkbookStore.getState()
  if (open === null) return false

  const to = path ?? (await pickSavePath())
  if (to === null) return false

  try {
    await saveWorkbookTo(open, to, { edited })
    useWorkbookStore.getState().saved(to)
    return true
  } catch (error) {
    useWorkbookStore
      .getState()
      .fail(error instanceof Error ? error.message : `Could not save ${baseName(to)}.`)
    return false
  }
}

async function pickSavePath(): Promise<string | null> {
  if (!isTauri()) return null

  const chosen = await saveDialog({
    defaultPath: 'Workbook.xlsx',
    filters: [{ name: 'Workbook', extensions: ['xlsx'] }],
  })

  return typeof chosen === 'string' ? chosen : null
}
