import { setPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { formatReference } from './reference'

/**
 * A workbook made from nothing.
 *
 * Small on purpose: the parts Excel insists on and not one more. A workbook
 * embedded beside a chart holds a table of numbers and is opened by "Edit
 * Data"; the styles, the theme and the calculation chain that a real file
 * carries are things Excel writes itself the first time it saves.
 *
 * Words are written as inline strings rather than into a shared table, for the
 * reason the cell writer gives: the table has counts to keep right and buys
 * nothing anybody can see.
 */

export interface NewSheet {
  name: string
  /** Row by row, left to right. A blank is a cell that is not written at all. */
  rows: readonly (readonly (number | string | null)[])[]
}

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const RELATIONSHIPS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const escaped = (text: string): string =>
  text.replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')

function cell(reference: string, value: number | string): string {
  return typeof value === 'number'
    ? `<c r="${reference}"><v>${String(value)}</v></c>`
    : `<c r="${reference}" t="inlineStr"><is><t>${escaped(value)}</t></is></c>`
}

function sheetXml(sheet: NewSheet): string {
  const height = sheet.rows.length
  const width = Math.max(...sheet.rows.map((row) => row.length), 1)

  const rows = sheet.rows
    .map((row, index) => {
      const cells = row
        .map((value, column) =>
          value === null ? '' : cell(formatReference({ row: index, column }), value),
        )
        .join('')

      return `<row r="${String(index + 1)}">${cells}</row>`
    })
    .join('')

  const extent = `A1:${formatReference({ row: Math.max(height - 1, 0), column: Math.max(width - 1, 0) })}`

  return (
    `${DECLARATION}<worksheet xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}">` +
    `<dimension ref="${extent}"/><sheetViews><sheetView workbookViewId="0"/></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/><sheetData>${rows}</sheetData></worksheet>`
  )
}

/** A package holding one workbook, ready to be written as a zip. */
export function newWorkbook(sheets: readonly NewSheet[]): OoxmlPackage {
  const pkg: OoxmlPackage = { parts: new Map() }
  const named = sheets.length === 0 ? [{ name: 'Sheet1', rows: [] }] : sheets

  setPartText(
    pkg,
    '[Content_Types].xml',
    `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      named
        .map(
          (_, index) =>
            `<Override PartName="/xl/worksheets/sheet${String(index + 1)}.xml" ` +
            'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
        )
        .join('') +
      '</Types>',
  )

  setPartText(
    pkg,
    '_rels/.rels',
    `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${RELATIONSHIPS}/officeDocument" Target="xl/workbook.xml"/>` +
      '</Relationships>',
  )

  setPartText(
    pkg,
    'xl/workbook.xml',
    `${DECLARATION}<workbook xmlns="${MAIN}" xmlns:r="${RELATIONSHIPS}"><sheets>` +
      named
        .map(
          (sheet, index) =>
            `<sheet name="${escaped(sheet.name)}" sheetId="${String(index + 1)}" ` +
            `r:id="rId${String(index + 1)}"/>`,
        )
        .join('') +
      '</sheets></workbook>',
  )

  setPartText(
    pkg,
    'xl/_rels/workbook.xml.rels',
    `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      named
        .map(
          (_, index) =>
            `<Relationship Id="rId${String(index + 1)}" Type="${RELATIONSHIPS}/worksheet" ` +
            `Target="worksheets/sheet${String(index + 1)}.xml"/>`,
        )
        .join('') +
      '</Relationships>',
  )

  for (const [index, sheet] of named.entries()) {
    setPartText(pkg, `xl/worksheets/sheet${String(index + 1)}.xml`, sheetXml(sheet))
  }

  return pkg
}
