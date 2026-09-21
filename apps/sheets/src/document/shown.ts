import { formatCodeOf, resolveStyle } from '@orangery/ooxml-spreadsheet'
import type { Cell } from '@orangery/ooxml-spreadsheet'
import { formatValue, parseFormat } from '@orangery/numfmt'
import type { OpenWorkbook } from './workbook'

/**
 * What a cell reads as.
 *
 * The same question the grid answers for every visible cell, asked here for
 * the cells nobody is looking at — the ones going onto the clipboard. A date
 * copied into a text editor should be the date somebody saw, not the
 * five-figure number a workbook keeps it as.
 *
 * Without the grid's caches, because this is asked once per copied cell rather
 * than once per cell per frame; and without the conditional formatting, which
 * is a rule about a cell rather than something the cell is. A copy carries the
 * value, and the rule stays on the sheet it belongs to.
 */
export function shownText(open: OpenWorkbook, cell: Cell | null): string {
  if (cell === null || cell.value === null) return ''

  if (cell.type === 's') return open.strings[Number(cell.value)]?.text ?? ''
  if (cell.type === 'inlineStr' || cell.type === 'str') return cell.value
  if (cell.type === 'e') return cell.value
  if (cell.type === 'b') return cell.value === '1' ? 'TRUE' : 'FALSE'

  const number = Number(cell.value)
  if (!Number.isFinite(number)) return cell.value

  const styles = open.styles
  if (styles === null) return cell.value

  const code = formatCodeOf(styles, resolveStyle(styles, cell.style).numberFormat)
  return formatValue(number, code, { date1904: open.workbook.date1904 }).text
}

/**
 * What a cell holds, as somebody would type it again.
 *
 * The formula where there is one: a cell showing 42 that holds `=6*7` has to
 * open as `=6*7`, or a formula would be something you can only replace and
 * never change.
 *
 * Otherwise the value as it is stored rather than as it is shown. A cell
 * showing 0.33 may hold a third, and offering the rounded version would let
 * somebody commit it by accident and lose the two thirds of the precision
 * they had without ever being asked.
 *
 * Dates are the exception, and the reason they are is the same one: 45292 is
 * not what anybody typed and not what anybody would want to type again. A
 * date is the one kind of value whose stored form nobody recognises.
 */
export function editableText(open: OpenWorkbook, cell: Cell | null): string {
  if (cell === null) return ''
  if (cell.formula !== null) return `=${cell.formula.text}`
  if (cell.value === null) return ''

  if (cell.type === 's') return open.strings[Number(cell.value)]?.text ?? ''
  if (cell.type === 'inlineStr' || cell.type === 'str') return cell.value
  if (cell.type === 'e') return cell.value
  if (cell.type === 'b') return cell.value === '1' ? 'TRUE' : 'FALSE'

  const number = Number(cell.value)
  if (!Number.isFinite(number)) return cell.value

  return showsADate(open, cell) ? shownText(open, cell) : cell.value
}

/** Whether a cell's format is one that turns its number into a day. */
function showsADate(open: OpenWorkbook, cell: Cell): boolean {
  const styles = open.styles
  if (styles === null) return false

  const code = formatCodeOf(styles, resolveStyle(styles, cell.style).numberFormat)
  if (code === null) return false

  return parseFormat(code).sections.some((section) =>
    section.tokens.some((token) => token.kind === 'date' || token.kind === 'elapsed'),
  )
}
