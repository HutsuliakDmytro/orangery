import { putCell, regionAround, freeTableName } from '@orangery/ooxml-spreadsheet'
import type { Cell, Table } from '@orangery/ooxml-spreadsheet'
import type { GridRange } from '@orangery/grid'
import { shownText } from './shown'
import { looksLikeHeader } from './sort'
import { reshape } from './structure'
import { writeTables } from './table-parts'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * A range made into a table.
 *
 * A table is not a style, however much the button that makes one says
 * "format as". It is a thing with a name and named columns: rows added at its
 * edge join it, a formula written into one column fills the rest, and
 * `Table1[Revenue]` means the column rather than the cells that are in it
 * today. The engine already understands the last of those
 * (`crates/formula/src/table.rs`); this is what puts one in the file.
 */

/** Excel's own default, and the one every new table arrives wearing. */
const STYLE = 'TableStyleMedium2'

/**
 * The names of a table's columns, taken from the row above its figures.
 *
 * Every column has to be called something and no two the same, because a
 * structured reference names one of them: a table with two columns called
 * `Amount` would have a reference that means either. Excel numbers the
 * repeats and so does this.
 */
export function columnNames(
  open: OpenWorkbook,
  sheet: OpenSheet,
  row: number,
  left: number,
  right: number,
): string[] {
  const names: string[] = []

  for (let column = left; column <= right; column += 1) {
    const written = shownText(open, sheet.cells.rows.get(row)?.get(column) ?? null).trim()
    const wanted = written === '' ? `Column${String(column - left + 1)}` : written

    let name = wanted
    let at = 1
    while (names.some((one) => one.toLowerCase() === name.toLowerCase())) {
      at += 1
      name = `${wanted}${String(at)}`
    }

    names.push(name)
  }

  return names
}

/**
 * A table made over what is selected, or over the block a cell sits in.
 *
 * The first row becomes the header: a table with no header is legal in the
 * file and confusing everywhere else, and the row is written where it is
 * missing rather than left for the reader to wonder about.
 *
 * Null when there is nothing to make a table of, or when the range already
 * belongs to one — two tables over the same cells is a file Excel repairs.
 */
export function makeTable(open: OpenWorkbook, sheet: OpenSheet, range: GridRange): Table | null {
  const bounds = boundsOf(sheet, range)
  if (bounds === null) return null

  const overlaps = sheet.tables.some(
    (one) =>
      bounds.top <= Math.max(one.range.from.row, one.range.to.row) &&
      bounds.bottom >= Math.min(one.range.from.row, one.range.to.row) &&
      bounds.left <= Math.max(one.range.from.column, one.range.to.column) &&
      bounds.right >= Math.min(one.range.from.column, one.range.to.column),
  )
  if (overlaps) return null

  /**
   * A table has to have a header, and a range often has not.
   *
   * Excel asks; this looks, with the same guess the sort uses, and makes the
   * row where there is none — by putting a row in above rather than writing
   * over the first row of somebody's figures.
   */
  const headed = looksLikeHeader(open, sheet, {
    sheet: null,
    from: { row: bounds.top, column: bounds.left },
    to: { row: bounds.bottom, column: bounds.right },
  })

  if (!headed) {
    reshape(open, sheet, { axis: 'row', at: bounds.top, by: 1 })
    bounds.bottom += 1
  }

  const names = columnNames(open, sheet, bounds.top, bounds.left, bounds.right)
  const taken = [
    ...open.sheets.flatMap((one) => one.tables.map((table) => table.name)),
    ...open.workbook.definedNames.map((one) => one.name),
  ]

  const name = freeTableName(taken)
  const table: Table = {
    name,
    displayName: name,
    range: {
      sheet: null,
      from: { row: bounds.top, column: bounds.left },
      to: { row: bounds.bottom, column: bounds.right },
    },
    headerRows: 1,
    totalsRows: 0,
    columns: names.map((one, at) => ({
      name: one,
      id: String(at + 1),
      totalsFunction: null,
      totalsLabel: null,
      formula: null,
    })),
    style: {
      name: STYLE,
      firstColumn: false,
      lastColumn: false,
      rowStripes: true,
      columnStripes: false,
    },
    filtered: true,
  }

  // The header the table says it has, written where the sheet had none.
  for (const [at, one] of names.entries()) {
    const column = bounds.left + at
    const held = sheet.cells.rows.get(bounds.top)?.get(column) ?? null
    if (held !== null && shownText(open, held).trim() !== '') continue

    putCell(sheet.cells, blank(bounds.top, column, one, held))
  }

  sheet.tables.push(table)
  writeTables(open, sheet)

  return table
}

/**
 * A totals row put on a table, or taken off.
 *
 * The row is part of the table's range rather than a row underneath it, which
 * is what makes it move when rows are added — and what makes `SUBTOTAL` the
 * right function for it: a total inside the table must not count itself, and
 * must leave out whatever a filter has hidden.
 */
export function toggleTotals(open: OpenWorkbook, sheet: OpenSheet, table: Table): boolean {
  const top = Math.min(table.range.from.row, table.range.to.row)
  const bottom = Math.max(table.range.from.row, table.range.to.row)
  const left = Math.min(table.range.from.column, table.range.to.column)

  if (table.totalsRows > 0) {
    for (let column = left; column <= left + table.columns.length - 1; column += 1) {
      sheet.cells.rows.get(bottom)?.delete(column)
    }

    table.totalsRows = 0
    table.range = { ...table.range, to: { ...table.range.to, row: bottom - 1 } }
    table.columns = table.columns.map((one) => ({
      ...one,
      totalsFunction: null,
      totalsLabel: null,
    }))

    writeTables(open, sheet)
    return true
  }

  const row = bottom + 1
  table.totalsRows = 1
  table.range = { ...table.range, to: { ...table.range.to, row } }

  table.columns = table.columns.map((one, at) => {
    const column = left + at
    const numeric = hasNumbers(sheet, top + 1, bottom, column)

    if (at === 0 && !numeric) {
      putCell(sheet.cells, blank(row, column, 'Total', null))
      return { ...one, totalsFunction: null, totalsLabel: 'Total' }
    }
    if (!numeric) return { ...one, totalsFunction: null, totalsLabel: null }

    // 109 rather than 9: a total inside a table leaves out the rows a filter
    // has hidden, which is the whole reason the row is worth having.
    putCell(sheet.cells, formula(row, column, `SUBTOTAL(109,${table.name}[${one.name}])`))
    return { ...one, totalsFunction: 'sum', totalsLabel: null }
  })

  writeTables(open, sheet)
  return true
}

/** Whether a column holds any figures, which decides whether it totals. */
function hasNumbers(sheet: OpenSheet, top: number, bottom: number, column: number): boolean {
  for (let row = top; row <= bottom; row += 1) {
    const cell = sheet.cells.rows.get(row)?.get(column)
    if (cell?.type === 'n' && cell.value !== null) return true
  }

  return false
}

const blank = (row: number, column: number, text: string, held: Cell | null): Cell => ({
  row,
  column,
  type: 'inlineStr',
  value: text,
  style: held?.style ?? null,
  formula: null,
  rich: null,
  carried: held?.carried ?? null,
})

const formula = (row: number, column: number, text: string): Cell => ({
  row,
  column,
  type: 'n',
  value: null,
  style: null,
  formula: { text, kind: 'normal', shared: null, ref: null, carried: null },
  rich: null,
  carried: null,
})

/** What a table is over: the selection, or the block a single cell sits in. */
function boundsOf(
  sheet: OpenSheet,
  range: GridRange,
): { top: number; bottom: number; left: number; right: number } | null {
  const single = range.anchor.row === range.focus.row && range.anchor.column === range.focus.column

  const found = single
    ? regionAround(sheet.cells, range.anchor)
    : {
        from: { row: range.anchor.row, column: range.anchor.column },
        to: { row: range.focus.row, column: range.focus.column },
      }

  const top = Math.min(found.from.row, found.to.row)
  const bottom = Math.max(found.from.row, found.to.row)
  const left = Math.min(found.from.column, found.to.column)
  const right = Math.max(found.from.column, found.to.column)

  // One row is a header with nothing under it, which is not a table.
  return bottom === top ? null : { top, bottom, left, right }
}
