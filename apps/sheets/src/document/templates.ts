import { putCell, styleWith } from '@orangery/ooxml-spreadsheet'
import type { Cell, LookChange } from '@orangery/ooxml-spreadsheet'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * Workbooks that start with something in them.
 *
 * A blank sheet is the right thing to give somebody who knows what they are
 * making. A template is for the other case, and its job is not to be pretty:
 * it is to show where the figures go and to have the sums already written, so
 * that the first thing somebody does is type a number rather than work out
 * what `SUM` is called.
 *
 * Built by filling a blank workbook rather than by shipping five `.xlsx`
 * files. Files would have to be kept in step with every change to the writer,
 * and a template that Excel opened and this program could not would be a
 * strange thing to ship.
 */

export type TemplateName = 'budget' | 'invoice' | 'ledger' | 'schedule' | 'academic'

export const TEMPLATES: { name: TemplateName; label: string }[] = [
  { name: 'budget', label: 'Monthly budget' },
  { name: 'invoice', label: 'Invoice' },
  { name: 'ledger', label: 'Cash book' },
  { name: 'schedule', label: 'Weekly schedule' },
  { name: 'academic', label: 'Table (ДСТУ)' },
]

/** A workbook filled in as the template says. */
export function fillTemplate(open: OpenWorkbook, sheet: OpenSheet, name: TemplateName): void {
  const write = writer(open, sheet)

  switch (name) {
    case 'budget': {
      budget(write)
      return
    }
    case 'invoice': {
      invoice(write)
      return
    }
    case 'ledger': {
      ledger(write)
      return
    }
    case 'schedule': {
      schedule(write)
      return
    }
    case 'academic': {
      academic(write)
      return
    }
  }
}

/** What a template is written with: a cell, a look, and a column width. */
interface Writer {
  text: (row: number, column: number, value: string, look?: LookChange) => void
  number: (row: number, column: number, value: number, look?: LookChange) => void
  formula: (row: number, column: number, text: string, look?: LookChange) => void
  width: (column: number, characters: number) => void
  sheet: OpenSheet
}

const HEADING: LookChange = {
  font: { bold: true, color: { kind: 'rgb', hex: 'FFFFFFFF' } },
  fill: { kind: 'rgb', hex: 'FF4472C4' },
  alignment: { horizontal: 'center' },
}

const TOTAL: LookChange = {
  font: { bold: true },
  border: { top: { style: 'thin', color: null } },
}

const MONEY: LookChange = { numberFormat: '#,##0.00' }
const DATE: LookChange = { numberFormat: 'yyyy-mm-dd' }

function writer(open: OpenWorkbook, sheet: OpenSheet): Writer {
  const styles = open.styles

  const put = (
    row: number,
    column: number,
    cell: Omit<Cell, 'row' | 'column' | 'style'>,
    look?: LookChange,
  ) => {
    const style =
      styles === null || look === undefined
        ? null
        : styleWith(styles, open.styleChanges, null, look)

    putCell(sheet.cells, { row, column, style, ...cell })
  }

  return {
    sheet,
    text: (row, column, value, look) => {
      put(row, column, { type: 'inlineStr', value, formula: null, rich: null, carried: null }, look)
    },
    number: (row, column, value, look) => {
      put(
        row,
        column,
        { type: 'n', value: String(value), formula: null, rich: null, carried: null },
        look,
      )
    },
    formula: (row, column, text, look) => {
      put(
        row,
        column,
        {
          type: 'n',
          value: null,
          formula: { text, kind: 'normal', shared: null, ref: null, carried: null },
          rich: null,
          carried: null,
        },
        look,
      )
    },
    width: (column, characters) => {
      sheet.sheet.columns.push({
        from: column,
        to: column,
        width: characters,
        custom: true,
        hidden: false,
        style: null,
        outlineLevel: null,
        collapsed: false,
        carried: null,
      })
    },
  }
}

/**
 * A month of money in and money out.
 *
 * The sums are written before the figures are, which is the whole point:
 * somebody types into the middle of a column and the total at the bottom
 * moves.
 */
function budget(write: Writer): void {
  const rows = ['Rent', 'Food', 'Transport', 'Utilities', 'Other']

  write.text(0, 0, 'Monthly budget', { font: { bold: true, size: 14 } })
  write.text(2, 0, 'Category', HEADING)
  write.text(2, 1, 'Planned', HEADING)
  write.text(2, 2, 'Actual', HEADING)
  write.text(2, 3, 'Difference', HEADING)

  for (const [at, name] of rows.entries()) {
    const row = 3 + at
    write.text(row, 0, name)
    write.number(row, 1, 0, MONEY)
    write.number(row, 2, 0, MONEY)
    write.formula(row, 3, `C${String(row + 1)}-B${String(row + 1)}`, MONEY)
  }

  const total = 3 + rows.length
  write.text(total, 0, 'Total', TOTAL)
  for (const column of ['B', 'C', 'D']) {
    write.formula(total, column.charCodeAt(0) - 65, `SUM(${column}4:${column}${String(total)})`, {
      ...TOTAL,
      ...MONEY,
    })
  }

  write.width(0, 18)
  for (const column of [1, 2, 3]) write.width(column, 12)
}

/** A bill: who it is for, what it is for, and what it comes to. */
function invoice(write: Writer): void {
  write.text(0, 0, 'Invoice', { font: { bold: true, size: 16 } })
  write.text(2, 0, 'To')
  write.text(3, 0, 'Invoice number')
  write.text(4, 0, 'Date')
  write.formula(4, 1, 'TODAY()', DATE)

  write.text(6, 0, 'Description', HEADING)
  write.text(6, 1, 'Quantity', HEADING)
  write.text(6, 2, 'Price', HEADING)
  write.text(6, 3, 'Amount', HEADING)

  for (let at = 0; at < 6; at += 1) {
    const row = 7 + at
    write.number(row, 1, 0)
    write.number(row, 2, 0, MONEY)
    write.formula(row, 3, `B${String(row + 1)}*C${String(row + 1)}`, MONEY)
  }

  write.text(14, 2, 'Subtotal', TOTAL)
  write.formula(14, 3, 'SUM(D8:D13)', { ...TOTAL, ...MONEY })
  write.text(15, 2, 'VAT 20%')
  write.formula(15, 3, 'D15*0.2', MONEY)
  write.text(16, 2, 'Total', TOTAL)
  write.formula(16, 3, 'D15+D16', { ...TOTAL, ...MONEY })

  write.width(0, 32)
  for (const column of [1, 2, 3]) write.width(column, 12)
}

/**
 * A cash book: what came in, what went out, and what is left.
 *
 * The balance is a running total — each row's is the row above plus this
 * row's movement — which is the one formula everybody writes by hand and
 * gets wrong on the first row.
 */
function ledger(write: Writer): void {
  write.text(0, 0, 'Cash book', { font: { bold: true, size: 14 } })
  write.text(2, 0, 'Date', HEADING)
  write.text(2, 1, 'Description', HEADING)
  write.text(2, 2, 'In', HEADING)
  write.text(2, 3, 'Out', HEADING)
  write.text(2, 4, 'Balance', HEADING)

  write.text(3, 1, 'Opening balance')
  write.number(3, 4, 0, MONEY)

  for (let at = 0; at < 12; at += 1) {
    const row = 4 + at
    write.number(row, 2, 0, MONEY)
    write.number(row, 3, 0, MONEY)
    write.formula(row, 4, `E${String(row)}+C${String(row + 1)}-D${String(row + 1)}`, MONEY)
  }

  write.width(0, 12)
  write.width(1, 28)
  for (const column of [2, 3, 4]) write.width(column, 12)
}

/** A week, with the days across the top and the hours down the side. */
function schedule(write: Writer): void {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

  write.text(0, 0, 'Week', { font: { bold: true, size: 14 } })
  write.text(2, 0, 'Time', HEADING)
  for (const [at, day] of days.entries()) write.text(2, 1 + at, day, HEADING)

  for (let hour = 8; hour <= 18; hour += 1) {
    write.text(3 + hour - 8, 0, `${String(hour).padStart(2, '0')}:00`, {
      alignment: { horizontal: 'right' },
    })
  }

  write.width(0, 8)
  for (const at of days.keys()) write.width(1 + at, 14)
}

/**
 * The table a Ukrainian thesis wants.
 *
 * ДСТУ has rules about tables and the ones that show are these: the caption
 * goes above it and to the left, the columns are numbered under their names,
 * and the body is Times New Roman at fourteen with a line and a half between
 * rows. The numbering row is the part people forget and the part a reviewer
 * notices.
 */
function academic(write: Writer): void {
  const body: LookChange = { font: { name: 'Times New Roman', size: 14 } }
  const head: LookChange = {
    ...body,
    font: { name: 'Times New Roman', size: 14, bold: true },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: {
      left: { style: 'thin', color: null },
      right: { style: 'thin', color: null },
      top: { style: 'thin', color: null },
      bottom: { style: 'thin', color: null },
    },
  }

  write.text(0, 0, 'Таблиця 1.1 — Назва таблиці', body)

  const columns = ['Показник', 'Позначення', 'Значення', 'Одиниця']
  for (const [at, name] of columns.entries()) write.text(1, at, name, head)
  for (const at of columns.keys()) {
    write.number(2, at, at + 1, { ...head, font: { ...head.font, bold: false } })
  }

  for (let at = 0; at < 6; at += 1) {
    for (const column of columns.keys()) {
      write.text(3 + at, column, '', {
        ...body,
        border: {
          left: { style: 'thin', color: null },
          right: { style: 'thin', color: null },
          top: { style: 'thin', color: null },
          bottom: { style: 'thin', color: null },
        },
      })
    }
  }

  write.width(0, 28)
  write.width(1, 16)
  write.width(2, 16)
  write.width(3, 14)
}
