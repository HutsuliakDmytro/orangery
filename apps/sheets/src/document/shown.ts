import { formatCodeOf, resolveStyle } from '@orangery/ooxml-spreadsheet'
import type { Cell } from '@orangery/ooxml-spreadsheet'
import { formatValue } from '@orangery/numfmt'
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
