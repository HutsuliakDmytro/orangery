import { invoke } from '@tauri-apps/api/core'
import { open as openDialog, save as saveDialog } from '@tauri-apps/plugin-dialog'
import { isTauri } from '@orangery/platform'
import { asTyped, decodeCsv, parseCsv, sniffDelimiter, writeCsv } from './csv'
import type { CsvOptions, Encoding } from './csv'
import { applyEdit, applyLook } from './edit'
import { applyFilter } from './filter'
import { blankWorkbook } from './new'
import { shownText } from './shown'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * A table on its way in from, or out to, a text file.
 *
 * Importing makes a new workbook rather than adding a sheet to the one that is
 * open: a `.csv` is a file, and opening a file is not the same gesture as
 * pasting into one. Pasting a table in is what the clipboard is for, and it
 * already works.
 */

export interface ImportOptions extends CsvOptions {
  encoding: Encoding
  /** Whether the first row names the columns rather than being one of them. */
  header: boolean
}

/** What the wizard should suggest, read off the file itself. */
export function guessOptions(bytes: Uint8Array): ImportOptions {
  // Sniffed from UTF-8 even where the file is not: the separators and the
  // digits are the same bytes in every encoding this offers, and the words
  // between them do not matter for the guess.
  const text = decodeCsv(bytes, 'utf-8')
  const delimiter = sniffDelimiter(text)

  return {
    delimiter,
    // A semicolon is what a file uses when its numbers have commas in them.
    decimal: delimiter === ';' ? ',' : '.',
    encoding: 'utf-8',
    header: true,
  }
}

/** The rows of a file, as it would be read with these answers. */
export const previewRows = (bytes: Uint8Array, options: ImportOptions): string[][] =>
  parseCsv(decodeCsv(bytes, options.encoding), options.delimiter).slice(0, 20)

/**
 * A workbook holding what the file held.
 *
 * Every field goes through the same reader a typed value does, so a date in a
 * `.csv` becomes a date and a number becomes a number — and, just as
 * importantly, a part number that looks like one does not. There is one
 * question a typed value never has to answer, which is which character is the
 * decimal point; the wizard asks it, and `asTyped` applies the answer.
 */
export async function workbookFromCsv(
  bytes: Uint8Array,
  options: ImportOptions,
): Promise<OpenWorkbook> {
  const rows = parseCsv(decodeCsv(bytes, options.encoding), options.delimiter)
  const open = await openWorkbook(await blankWorkbook())
  const sheet = open.sheets[0]
  if (sheet === undefined) return open

  for (const [row, fields] of rows.entries()) {
    for (const [column, field] of fields.entries()) {
      if (field === '') continue
      applyEdit(open, sheet, { row, column }, asTyped(field, options.decimal))
    }
  }

  if (options.header && rows.length > 1) markHeader(open, sheet, rows)
  return open
}

/**
 * The first row made to look and behave like one.
 *
 * Bold, and with the filter arrows on. "This row names the columns" has to
 * mean something or it is a question with no answer attached; those two are
 * what a header row is for, and both are things this app already does.
 */
function markHeader(open: OpenWorkbook, sheet: OpenSheet, rows: readonly string[][]): void {
  const width = Math.max(...rows.map((row) => row.length), 1)
  const columns = Array.from({ length: width }, (_, column) => ({ row: 0, column }))

  applyLook(open, sheet, columns, { font: { bold: true } })
  applyFilter(open, sheet, {
    range: {
      sheet: null,
      from: { row: 0, column: 0 },
      to: { row: rows.length - 1, column: width - 1 },
    },
    columns: [],
  })
}

/** A sheet as a text file, in the values somebody was looking at. */
export function csvFromSheet(open: OpenWorkbook, sheet: OpenSheet, delimiter: string): string {
  const rows = [...sheet.cells.rows.keys()].sort((a, b) => a - b)
  const last = rows[rows.length - 1] ?? -1

  const width = Math.max(
    ...[...sheet.cells.rows.values()].map((cells) => Math.max(...cells.keys(), -1) + 1),
    0,
  )

  // Every row from the first to the last, gaps included: a file that skipped
  // its empty rows would be a file whose rows no longer line up with the
  // sheet they came from.
  const table = Array.from({ length: last + 1 }, (_, row) =>
    Array.from({ length: width }, (_, column) =>
      shownText(open, sheet.cells.rows.get(row)?.get(column) ?? null),
    ),
  )

  return writeCsv(table, delimiter)
}

/** The file a person chose, or nothing where they chose nothing. */
export async function pickCsv(): Promise<{ bytes: Uint8Array; path: string } | null> {
  if (!isTauri()) return null

  const chosen = await openDialog({
    multiple: false,
    directory: false,
    filters: [{ name: 'Text', extensions: ['csv', 'tsv', 'txt'] }],
  })
  if (typeof chosen !== 'string') return null

  const loaded = await invoke<{ bytes: number[] }>('read_document', { path: chosen })
  return { bytes: new Uint8Array(loaded.bytes), path: chosen }
}

/** Writes a sheet out, and says where it went. */
export async function exportCsv(
  open: OpenWorkbook,
  sheet: OpenSheet,
  delimiter: string,
): Promise<string | null> {
  if (!isTauri()) return null

  const to = await saveDialog({
    defaultPath: `${sheet.name}.csv`,
    filters: [{ name: 'Text', extensions: ['csv'] }],
  })
  if (typeof to !== 'string') return null

  // UTF-8 with a mark on the front: without it Excel on Windows reads a
  // Ukrainian column as its 1252 lookalike, which is the single most common
  // way a correct export arrives looking broken.
  const text = `\uFEFF${csvFromSheet(open, sheet, delimiter)}`
  const bytes = new TextEncoder().encode(text)

  await invoke('write_document', { path: to, bytes: [...bytes], keepBackup: true })
  return to
}
