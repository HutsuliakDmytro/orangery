import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { baseName, isTauri } from '@orangery/platform'
import { useWorkbookStore } from '../store/workbook-store'
import { visibleSheets } from './workbook'
import { clearSnapshot, readSnapshot } from './autosave'
import { exportCsv } from './csv-file'
import { isOds, odsBytes, workbookFromOds } from './converters/ods-file'
import { blankWorkbook } from './new'
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

    // An `.ods` is converted rather than opened, and the workbook it becomes
    // belongs to no file: writing our own bytes over somebody's OpenDocument
    // would change the format of their file without saying so.
    if (await isOds(bytes)) {
      useWorkbookStore
        .getState()
        .converted(
          await workbookFromOds(bytes),
          `${baseName(path)} was opened as a copy. Saving writes a workbook, not an .ods.`,
        )
      return true
    }

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
  return to === null ? false : writeTo(open, to, edited)
}

/** The one place a workbook is written, whichever door asked for it. */
async function writeTo(
  open: Parameters<typeof saveWorkbookTo>[0],
  to: string,
  edited = true,
): Promise<boolean> {
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

/**
 * An empty workbook, belonging to no file yet.
 *
 * It opens with no path, so the first save asks where. That is the same door
 * a workbook opened from disk goes through, which is why saving is one
 * function rather than two.
 */
export async function newWorkbookFile(): Promise<void> {
  await useWorkbookStore.getState().load(await blankWorkbook(), null)
}

/** Writes the workbook somewhere else, and belongs to that file afterwards. */
export async function saveWorkbookAs(): Promise<boolean> {
  const { open } = useWorkbookStore.getState()
  if (open === null) return false

  const to = await pickSavePath()
  return to === null ? false : writeTo(open, to)
}

/**
 * Opens what a workbook looked like when the program stopped.
 *
 * It opens as the file it came from, so saving goes where it was going; a
 * workbook that had never been saved comes back with no path, exactly as it
 * was. The snapshot is cleared once it is in front of somebody — the point of
 * keeping it was to get it here.
 */
export async function recoverWorkbook(key: string, path: string | null): Promise<boolean> {
  try {
    const bytes = await readSnapshot(key)
    if (bytes === null) return false

    await useWorkbookStore.getState().load(bytes, path)
    await clearSnapshot(key)
    return true
  } catch (error) {
    useWorkbookStore
      .getState()
      .fail(error instanceof Error ? error.message : 'Could not recover that workbook.')
    return false
  }
}

/**
 * Writes the whole workbook out as an OpenDocument spreadsheet.
 *
 * Every sheet, unlike the `.csv` below: an `.ods` holds a workbook, so there
 * is nothing to choose between.
 */
export async function exportOds(): Promise<boolean> {
  const { open } = useWorkbookStore.getState()
  if (open === null || !isTauri()) return false

  const to = await saveDialog({
    defaultPath: 'Workbook.ods',
    filters: [{ name: 'OpenDocument spreadsheet', extensions: ['ods'] }],
  })
  if (typeof to !== 'string') return false

  try {
    const bytes = await odsBytes(open)
    await invoke('write_document', { path: to, bytes: [...bytes], keepBackup: true })
    return true
  } catch (error) {
    useWorkbookStore
      .getState()
      .fail(error instanceof Error ? error.message : 'Could not write that file.')
    return false
  }
}

/**
 * Writes the sheet on screen out as a text file.
 *
 * One sheet, because a `.csv` holds one table and a workbook of five sheets
 * written into one file would be five tables nobody can tell apart.
 */
export async function exportSheet(): Promise<boolean> {
  const { open, current } = useWorkbookStore.getState()
  if (open === null) return false

  const sheet = visibleSheets(open)[current]
  if (sheet === undefined) return false

  try {
    return (await exportCsv(open, sheet, ',')) !== null
  } catch (error) {
    useWorkbookStore
      .getState()
      .fail(error instanceof Error ? error.message : 'Could not write that file.')
    return false
  }
}
