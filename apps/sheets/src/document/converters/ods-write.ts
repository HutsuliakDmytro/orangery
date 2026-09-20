import { parseFormat, serialToDate } from '@orangery/numfmt'
import type { Section } from '@orangery/numfmt'
import { mergeCovering } from '@orangery/ooxml-spreadsheet'
import type { Cell, CellRange } from '@orangery/ooxml-spreadsheet'

/**
 * OpenDocument Spreadsheet, written.
 *
 * The values, the formulas and the merges — the parts of a sheet that are the
 * sheet. Fonts, fills and borders are not written: this is a conversion
 * rather than a save, and a format the app does not promise to preserve is
 * one it should not pretend to. Somebody exporting to `.ods` wants the
 * numbers somewhere else, and a half-carried look is worse than an honest
 * plain one.
 *
 * What is carried carefully is the type. An `.ods` says what a value is —
 * float, date, percentage, boolean — separately from what it shows, and a
 * writer that wrote everything as text would produce a file whose numbers
 * cannot be added up.
 */

const escaped = (text: string): string =>
  text.replace(
    /[&<>"]/gu,
    (one) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[one] ?? ''};`,
  )

const holds = (section: Section | undefined, kind: 'date' | 'elapsed'): boolean =>
  section?.tokens.some((token) => token.kind === kind) ?? false

/** What a format code makes of a number, as far as ODF has a word for it. */
export function kindOf(code: string): 'date' | 'time' | 'percentage' | 'float' {
  const format = parseFormat(code)
  const first = format.sections[0]

  if (holds(first, 'elapsed')) return 'time'

  if (holds(first, 'date')) {
    // A code with hours and no day is a time of day; one with both is a date,
    // and ODF writes a date with a time in it as a date.
    const dates = first?.tokens.filter((token) => token.kind === 'date') ?? []
    const days = dates.some((token) => /^(y+|d+|mmm+)$/iu.test(token.code))
    return days ? 'date' : 'time'
  }

  return code.includes('%') ? 'percentage' : 'float'
}

/** An A1 formula in ODF's own spelling, which is the other half of reading one. */
export function formulaTo(text: string): string {
  const referenced = text.replace(
    /(?:'[^']+'|[A-Za-z_][\w.]*)?!?\$?[A-Za-z]{1,3}\$?\d{1,7}(?::\$?[A-Za-z]{1,3}\$?\d{1,7})?/gu,
    (match) => {
      const at = match.indexOf('!')
      const sheet = at < 0 ? '' : match.slice(0, at)
      const cells = at < 0 ? match : match.slice(at + 1)
      const named = sheet === '' ? '' : `$${sheet}`

      return `[${cells
        .split(':')
        .map((one) => `${named}.${one}`)
        .join(':')}]`
    },
  )

  return `of:=${referenced.replace(/,/gu, ';')}`
}

/** The ISO date an Excel serial number stands for, in the workbook's own system. */
function dateValue(serial: number, date1904: boolean): string {
  const parts = serialToDate(serial, date1904)
  // Before 1900 in the 1900 system there is no date to write; the number goes
  // out as the number it is rather than as an invented day.
  if (parts === null) return '1899-12-30'

  const two = (value: number) => String(value).padStart(2, '0')
  const day = `${String(parts.year)}-${two(parts.month)}-${two(parts.day)}`

  if (parts.hours === 0 && parts.minutes === 0 && parts.seconds === 0) return day
  return `${day}T${two(parts.hours)}:${two(parts.minutes)}:${two(Math.floor(parts.seconds))}`
}

/** The same thing for a duration, which ODF writes as a length of time. */
function timeValue(serial: number): string {
  const total = Math.round(Math.abs(serial) * 24 * 3600)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  const two = (value: number) => String(value).padStart(2, '0')

  return `PT${two(hours)}H${two(minutes)}M${two(seconds)}S`
}

export interface CellToWrite {
  cell: Cell | null
  /** What it shows, which is what goes inside the paragraph. */
  shown: string
  /** The format code, for deciding what kind of value it is. */
  code: string
}

/** One `<table:table-cell>`, with its type said as well as its text. */
export function odsCell(
  written: CellToWrite,
  options: { date1904: boolean; spans?: { rows: number; columns: number } | null },
): string {
  const { cell, shown, code } = written
  const spans = options.spans ?? null

  const spanned =
    spans === null
      ? ''
      : ` table:number-columns-spanned="${String(spans.columns)}"` +
        ` table:number-rows-spanned="${String(spans.rows)}"`

  const formula =
    cell?.formula == null ? '' : ` table:formula="${escaped(formulaTo(cell.formula.text))}"`
  const paragraph = shown === '' ? '' : `<text:p>${escaped(shown)}</text:p>`

  if (cell === null || cell.value === null) {
    return spanned === '' && formula === ''
      ? '<table:table-cell/>'
      : `<table:table-cell${spanned}${formula}/>`
  }

  if (cell.type === 'b') {
    const value = cell.value === '1' ? 'true' : 'false'
    return (
      `<table:table-cell${spanned}${formula} office:value-type="boolean" ` +
      `office:boolean-value="${value}">${paragraph}</table:table-cell>`
    )
  }

  const number = Number(cell.value)
  const numeric = (cell.type === 'n' || cell.type === 'd') && Number.isFinite(number)

  if (!numeric) {
    return (
      `<table:table-cell${spanned}${formula} office:value-type="string">` +
      `${paragraph}</table:table-cell>`
    )
  }

  const kind = kindOf(code)

  if (kind === 'date') {
    return (
      `<table:table-cell${spanned}${formula} office:value-type="date" ` +
      `office:date-value="${dateValue(number, options.date1904)}">${paragraph}</table:table-cell>`
    )
  }

  if (kind === 'time') {
    return (
      `<table:table-cell${spanned}${formula} office:value-type="time" ` +
      `office:time-value="${timeValue(number)}">${paragraph}</table:table-cell>`
    )
  }

  if (kind === 'percentage') {
    return (
      `<table:table-cell${spanned}${formula} office:value-type="percentage" ` +
      `office:value="${String(number)}">${paragraph}</table:table-cell>`
    )
  }

  return (
    `<table:table-cell${spanned}${formula} office:value-type="float" ` +
    `office:value="${String(number)}">${paragraph}</table:table-cell>`
  )
}

export interface SheetToConvert {
  name: string
  /** As far as the cells reach; a rectangle, which is what a table is. */
  rows: number
  columns: number
  merges: readonly CellRange[]
  at: (row: number, column: number) => CellToWrite
}

/** A whole `<table:table>`, rows and all. */
export function odsTable(sheet: SheetToConvert, date1904: boolean): string {
  const lines: string[] = []

  for (let row = 0; row < sheet.rows; row += 1) {
    const cells: string[] = []

    for (let column = 0; column < sheet.columns; column += 1) {
      const merge = mergeCovering(sheet.merges, { row, column })

      // A cell a merge is drawn over is written as covered: the merge belongs
      // to the corner, and ODF says so on every cell it reaches.
      if (merge !== null && (merge.from.row !== row || merge.from.column !== column)) {
        cells.push('<table:covered-table-cell/>')
        continue
      }

      const spans =
        merge === null
          ? null
          : {
              rows: Math.abs(merge.to.row - merge.from.row) + 1,
              columns: Math.abs(merge.to.column - merge.from.column) + 1,
            }

      cells.push(odsCell(sheet.at(row, column), { date1904, spans }))
    }

    lines.push(`<table:table-row>${cells.join('')}</table:table-row>`)
  }

  const columns = `<table:table-column table:number-columns-repeated="${String(
    Math.max(sheet.columns, 1),
  )}"/>`

  return `<table:table table:name="${escaped(sheet.name)}">${columns}${lines.join('')}</table:table>`
}

const CONTENT_NAMESPACES =
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" ' +
  'xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" ' +
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" ' +
  'xmlns:of="urn:oasis:names:tc:opendocument:xmlns:of:1.2" ' +
  'office:version="1.3"'

/** The whole of `content.xml`, which is where an `.ods` keeps its tables. */
export const odsContent = (sheets: readonly SheetToConvert[], date1904: boolean): string =>
  '<?xml version="1.0" encoding="UTF-8"?>' +
  `<office:document-content ${CONTENT_NAMESPACES}>` +
  '<office:body><office:spreadsheet>' +
  sheets.map((sheet) => odsTable(sheet, date1904)).join('') +
  '</office:spreadsheet></office:body></office:document-content>'
