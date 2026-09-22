import { getPartText, readPackage, setPartText, writePackage } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { extentOf, formatCodeOf, resolveStyle, withMerge } from '@orangery/ooxml-spreadsheet'
import { applyEdit } from '../edit'
import { blankWorkbook } from '../new'
import { addSheet } from '../sheets'
import { shownText } from '../shown'
import { openWorkbook } from '../workbook'
import type { OpenWorkbook } from '../workbook'
import { readOds } from './ods'
import { odsContent } from './ods-write'
import type { SheetToConvert } from './ods-write'

/**
 * A spreadsheet on its way in from, or out to, OpenDocument.
 *
 * Importing makes a workbook, the way a `.csv` does and for the same reason:
 * an `.ods` is a file, and opening a file is not the gesture that pastes
 * something into one. Every value goes through the reader typing uses, so a
 * date arrives as a date and a part number stays a part number — the file
 * says which is which, and the apostrophe carries that answer across.
 *
 * Exporting writes the values, the formulas and the merges. Not the look:
 * this is a conversion, not a save, and a format we do not promise to
 * preserve is one we should not pretend to. That is a decision rather than a
 * gap — `PLAN.md` says basic, and basic here means the numbers arrive whole.
 */

const MIME_TYPE = 'application/vnd.oasis.opendocument.spreadsheet'

/** A workbook holding what the file held. */
export async function workbookFromOds(bytes: Uint8Array): Promise<OpenWorkbook> {
  const sheets = await readOds(bytes)
  const open = await openWorkbook(await blankWorkbook())

  for (const [index, table] of sheets.entries()) {
    // The first sheet is the one the blank workbook came with; the rest are
    // added, which is the same path the tabs take.
    const at = index === 0 ? 0 : (addSheet(open, { name: table.name }) ?? 0)
    const sheet = open.sheets[at]
    if (sheet === undefined) continue

    if (index === 0) sheet.name = table.name

    for (const cell of table.cells) {
      if (cell.typed !== '') {
        applyEdit(open, sheet, { row: cell.row, column: cell.column }, cell.typed)
      }

      // The formula after the value, so the cell keeps the number the file
      // remembered: nothing here recalculates, and the value is what a reader
      // would have shown.
      if (cell.formula !== null) {
        const existing = sheet.cells.rows.get(cell.row)?.get(cell.column)
        if (existing !== undefined) {
          existing.formula = {
            text: cell.formula,
            kind: 'normal',
            shared: null,
            ref: null,
            carried: null,
          }
        }
      }

      if (cell.spans !== null) {
        sheet.sheet.merges = withMerge(sheet.sheet.merges, {
          sheet: null,
          from: { row: cell.row, column: cell.column },
          to: {
            row: cell.row + cell.spans.rows - 1,
            column: cell.column + cell.spans.columns - 1,
          },
        })
      }
    }
  }

  // Renaming the first sheet has to reach the workbook part as well, or the
  // file says one thing and the tab says another.
  const first = open.workbook.sheets[0]
  const table = sheets[0]
  if (first !== undefined && table !== undefined) first.name = table.name

  return open
}

/** The workbook as an `.ods`, ready for the disk. */
export async function odsBytes(open: OpenWorkbook): Promise<Uint8Array> {
  const tables: SheetToConvert[] = open.sheets.map((sheet) => {
    const extent = extentOf(sheet.cells)

    return {
      name: sheet.name,
      rows: extent.rows,
      columns: extent.columns,
      merges: sheet.sheet.merges,
      at: (row, column) => {
        const cell = sheet.cells.rows.get(row)?.get(column) ?? null
        const styles = open.styles

        return {
          cell,
          shown: shownText(open, cell),
          code:
            styles === null
              ? 'General'
              : (formatCodeOf(styles, resolveStyle(styles, cell?.style ?? null).numberFormat) ??
                'General'),
        }
      },
    }
  })

  const pkg: OoxmlPackage = { parts: new Map() }

  // `mimetype` first and uncompressed, which is how a reader tells an `.ods`
  // from any other zip before it has opened anything inside it.
  setPartText(pkg, 'mimetype', MIME_TYPE)
  setPartText(pkg, 'META-INF/manifest.xml', manifest())
  setPartText(pkg, 'content.xml', odsContent(tables, open.workbook.date1904))
  setPartText(pkg, 'styles.xml', styles())

  return writePackage(pkg, { stored: ['mimetype'] })
}

/** The list of parts an OpenDocument package has to carry with it. */
const manifest = (): string =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" ' +
  'manifest:version="1.3">' +
  `<manifest:file-entry manifest:full-path="/" manifest:media-type="${MIME_TYPE}"/>` +
  '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>' +
  '<manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>' +
  '</manifest:manifest>'

/** An empty styles part, which the format expects even when it says nothing. */
const styles = (): string =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  '<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'office:version="1.3"><office:styles/></office:document-styles>'

/** Whether a package is an `.ods` at all, asked before anything is read out of it. */
export async function isOds(bytes: Uint8Array): Promise<boolean> {
  try {
    const pkg = await readPackage(bytes)
    const stated = getPartText(pkg, 'mimetype')
    return stated === MIME_TYPE || pkg.parts.has('content.xml')
  } catch {
    return false
  }
}
