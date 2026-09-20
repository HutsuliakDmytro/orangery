import { newWorkbook } from '@orangery/ooxml-spreadsheet'
import { setPartText, writePackage } from '@orangery/ooxml-core'

/**
 * A workbook made from nothing.
 *
 * `newWorkbook` in the package is deliberately the smallest thing Excel will
 * open, because that is what a chart's embedded table wants. A workbook
 * somebody is going to work in wants one part more: a `styles.xml`. Without
 * it there is no list to add a look to, and the toolbar has nothing to point
 * a cell at — so a new workbook could be typed in and never formatted.
 *
 * The contents are the smallest legal styles part. Excel insists on two fills
 * and the second must be `gray125`; nobody knows why any more, and a file
 * without it is one Excel offers to repair.
 */

const DECLARATION = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'

const STYLES =
  `${DECLARATION}<styleSheet xmlns="${MAIN}">` +
  '<fonts count="1"><font><sz val="11"/><color theme="1"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
  '</styleSheet>'

const CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml'
const RELATIONSHIP = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles'

/** The bytes of an empty workbook with one sheet in it. */
export async function blankWorkbook(): Promise<Uint8Array> {
  const pkg = newWorkbook([{ name: 'Sheet1', rows: [] }])

  setPartText(pkg, 'xl/styles.xml', STYLES)

  const types = pkg.parts.get('[Content_Types].xml')?.text ?? ''
  setPartText(
    pkg,
    '[Content_Types].xml',
    types.replace(
      '</Types>',
      `<Override PartName="/xl/styles.xml" ContentType="${CONTENT_TYPE}"/></Types>`,
    ),
  )

  const rels = pkg.parts.get('xl/_rels/workbook.xml.rels')?.text ?? ''
  setPartText(
    pkg,
    'xl/_rels/workbook.xml.rels',
    rels.replace(
      '</Relationships>',
      `<Relationship Id="rIdStyles" Type="${RELATIONSHIP}" Target="styles.xml"/></Relationships>`,
    ),
  )

  return writePackage(pkg)
}
