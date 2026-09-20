import { invoke } from '@tauri-apps/api/core'
import { getPartText, setPartText, writePackage } from '@orangery/ooxml-core'
import { patchStyles, writeWorkbook } from '@orangery/ooxml-spreadsheet'
import { isTauri } from '@orangery/platform'
import type { OpenWorkbook } from './workbook'

/**
 * Putting a workbook back on the disk.
 *
 * The bytes are built here and written by Rust, which is the same path the
 * other two apps take: a save has to be atomic and has to leave a backup, and
 * a webview can do neither.
 *
 * What is written is the package that was read, with the cells of each sheet
 * put back into their own parts. Everything else — the pivot caches, the
 * macros, the queries, the parts nothing here has heard of — goes back exactly
 * as it arrived (`docs/adr/0002-xlsx-roundtrip.md`).
 */

export interface SaveOptions {
  /** Whether anything was edited, which decides the fate of `calcChain`. */
  edited?: boolean
}

/** The workbook as bytes, ready for the disk or for a test to read back. */
export async function workbookBytes(
  open: OpenWorkbook,
  options: SaveOptions = {},
): Promise<Uint8Array> {
  writeWorkbook(
    open.pkg,
    open.sheets.map((sheet) => ({
      path: sheet.path,
      cells: sheet.cells,
      // Only when something was edited: an untouched sheet keeps the bytes of
      // its `<cols>` rather than being rewritten into the same thing.
      ...(options.edited === true
        ? {
            columns: sheet.sheet.columns,
            merges: sheet.sheet.merges,
            filter: sheet.sheet.autoFilter,
          }
        : {}),
    })),
    { edited: options.edited ?? false },
  )

  // Only when editing has asked for a look the file did not have; a workbook
  // nobody touched leaves `styles.xml` byte for byte as it arrived.
  const styles = getPartText(open.pkg, 'xl/styles.xml')
  if (styles !== undefined) {
    setPartText(open.pkg, 'xl/styles.xml', patchStyles(styles, open.styleChanges))
  }

  return writePackage(open.pkg)
}

/**
 * Writes a workbook to a path, atomically and with a backup behind it.
 *
 * The backup is the Rust side's doing and is asked for by name here, so that
 * the one place that decides whether a file may be overwritten is the one
 * place that overwrites it.
 */
export async function saveWorkbookTo(
  open: OpenWorkbook,
  path: string,
  options: SaveOptions = {},
): Promise<{ path: string; backupPath: string | null }> {
  if (!isTauri()) throw new Error('A workbook can only be saved from the app.')

  const bytes = await workbookBytes(open, options)
  const result = await invoke<{ path: string; backup_path: string | null }>('write_document', {
    path,
    bytes: [...bytes],
    keepBackup: true,
  })

  return { path: result.path, backupPath: result.backup_path }
}
