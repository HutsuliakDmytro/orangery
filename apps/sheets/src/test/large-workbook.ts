import JSZip from 'jszip'

/**
 * A workbook the size of a real one, built rather than kept.
 *
 * Two hundred thousand cells is a file people actually have — a year of
 * transactions, an export from some system — and it is the size the plan
 * states a budget against. Built on the spot because a fixture that big has no
 * business in a repository.
 */

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const RELS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

export interface LargeWorkbook {
  bytes: Uint8Array
  rows: number
  columns: number
}

const column = (index: number): string => {
  const letters: string[] = []
  for (let left = index + 1; left > 0; left = Math.floor((left - 1) / 26)) {
    letters.unshift(String.fromCharCode(64 + ((left - 1) % 26) + 1))
  }
  return letters.join('')
}

/**
 * Rows of mixed cells, because a sheet of one kind measures the wrong thing.
 *
 * A shared string, plain numbers, formatted ones and a formula with its cached
 * result: every path the reader has, in every row.
 */
function sheetXml(rows: number, columns: number): string {
  const body: string[] = []

  for (let row = 1; row <= rows; row += 1) {
    const cells: string[] = [`<c r="A${String(row)}" t="s"><v>${String(row % 50)}</v></c>`]

    for (let at = 1; at < columns; at += 1) {
      const reference = `${column(at)}${String(row)}`
      const style = at % 4
      cells.push(
        style === 3
          ? `<c r="${reference}" s="3"><f>SUM(B${String(row)}:D${String(row)})</f><v>${String(row * 3)}</v></c>`
          : `<c r="${reference}" s="${String(style)}"><v>${String(row + at / 4)}</v></c>`,
      )
    }

    body.push(`<row r="${String(row)}" spans="1:${String(columns)}">${cells.join('')}</row>`)
  }

  return (
    `${DECLARATION}<worksheet xmlns="${MAIN}" xmlns:r="${RELS}">` +
    `<dimension ref="A1:${column(columns - 1)}${String(rows)}"/>` +
    '<sheetViews><sheetView tabSelected="1" workbookViewId="0"/></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    `<sheetData>${body.join('')}</sheetData></worksheet>`
  )
}

export async function buildLargeWorkbook(rows = 2000, columns = 100): Promise<LargeWorkbook> {
  const zip = new JSZip()

  zip.file(
    '[Content_Types].xml',
    `${DECLARATION}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '</Types>',
  )
  zip.file(
    '_rels/.rels',
    `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${RELS}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  )
  zip.file(
    'xl/workbook.xml',
    `${DECLARATION}<workbook xmlns="${MAIN}" xmlns:r="${RELS}">` +
      '<sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
  )
  zip.file(
    'xl/_rels/workbook.xml.rels',
    `${DECLARATION}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
      `<Relationship Id="rId1" Type="${RELS}/worksheet" Target="worksheets/sheet1.xml"/>` +
      `<Relationship Id="rId2" Type="${RELS}/styles" Target="styles.xml"/>` +
      `<Relationship Id="rId3" Type="${RELS}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`,
  )
  zip.file(
    'xl/sharedStrings.xml',
    `${DECLARATION}<sst xmlns="${MAIN}" count="50" uniqueCount="50">` +
      Array.from({ length: 50 }, (_, index) => `<si><t>Row group ${String(index)}</t></si>`).join(
        '',
      ) +
      '</sst>',
  )
  zip.file(
    'xl/styles.xml',
    `${DECLARATION}<styleSheet xmlns="${MAIN}">` +
      '<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>' +
      '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
      '<font><b/><sz val="11"/><color rgb="FF1F4E79"/><name val="Calibri"/></font></fonts>' +
      '<fills count="3"><fill><patternFill patternType="none"/></fill>' +
      '<fill><patternFill patternType="gray125"/></fill>' +
      '<fill><patternFill patternType="solid"><fgColor rgb="FFF2F2F2"/></patternFill></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
      '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
      '<xf numFmtId="14" fontId="1" fillId="2" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1"/>' +
      '<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>' +
      '</cellXfs></styleSheet>',
  )
  zip.file('xl/worksheets/sheet1.xml', sheetXml(rows, columns))

  return { bytes: await zip.generateAsync({ type: 'uint8array' }), rows, columns }
}
