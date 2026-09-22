import { mainPartOf, relsPartFor } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'

/**
 * Where a SpreadsheetML package keeps things.
 *
 * `xl/workbook.xml` is what Excel writes and what a new workbook is given. It
 * is not what an opened package's workbook part necessarily is: that is
 * whatever `_rels/.rels` points its `officeDocument` relationship at, which is
 * usually this and legally anything. Two files in the corpus — POI's 49609 and
 * LibreOffice's tdf76115 — are read by Excel and were refused here for no
 * better reason than the name.
 */

export const CONVENTIONAL_WORKBOOK_PART = 'xl/workbook.xml'

/**
 * What `[Content_Types].xml` may call it for the package to be a workbook.
 *
 * A template and a workbook with macros in it are both workbooks as far as
 * opening one goes, and each says so differently.
 */
export const WORKBOOK_CONTENT_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.template.main+xml',
  'application/vnd.ms-excel.sheet.macroEnabled.main+xml',
  'application/vnd.ms-excel.template.macroEnabled.main+xml',
  'application/vnd.ms-excel.addin.macroEnabled.main+xml',
]

/** The workbook part of this package, by name or by relationship. */
export function workbookPart(pkg: OoxmlPackage): string {
  return mainPartOf(pkg, CONVENTIONAL_WORKBOOK_PART)
}

/** Where that part keeps its relationships, which follows its name. */
export function workbookRelsPart(pkg: OoxmlPackage): string {
  return relsPartFor(workbookPart(pkg))
}
