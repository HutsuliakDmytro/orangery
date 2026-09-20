import { useMemo } from 'react'
import { formatCodeOf, resolveColor, resolveStyle } from '@orangery/ooxml-spreadsheet'
import { formatValue } from '@orangery/numfmt'
import type { PageSetup } from '@orangery/ooxml-spreadsheet'
import { boundsToPrint, titleRows } from '../document/print'
import type { OpenSheet, OpenWorkbook } from '../document/workbook'

/**
 * The sheet as a printer sees it.
 *
 * Not the canvas. The canvas holds the cells somebody is looking at, and
 * printing wants the ones they are not — so this is an ordinary table of
 * HTML, laid out and paginated by the browser, which is the only thing in
 * the window that knows where a page ends.
 *
 * The rows a workbook asks to repeat go in a `<thead>`, because that is how
 * a browser is told to put them at the top of every page: the one piece of
 * pagination we get for nothing, and the reason this is a table rather than
 * a grid of boxes.
 *
 * Hidden on screen. It exists so that `window.print()` has something to
 * print, and a second copy of the sheet under the real one would be a
 * puzzling thing to scroll past.
 */

export interface PrintViewProps {
  open: OpenWorkbook
  sheet: OpenSheet
  setup: PageSetup
}

export function PrintView({ open, sheet, setup }: PrintViewProps) {
  const bounds = useMemo(() => boundsToPrint(open, sheet), [open, sheet])
  const titles = useMemo(() => titleRows(open, sheet), [open, sheet])

  if (bounds === null) return null

  const columns: number[] = []
  for (let column = bounds.left; column <= bounds.right; column += 1) columns.push(column)

  const heading: number[] = []
  const body: number[] = []
  for (let row = bounds.top; row <= bounds.bottom; row += 1) {
    const repeated = titles !== null && row >= titles.top && row <= titles.bottom ? heading : body
    repeated.push(row)
  }

  return (
    <div className="hidden print:block" data-testid="print-view">
      <table
        style={{
          borderCollapse: 'collapse',
          fontSize: '10pt',
          // A sheet asked to fit a page wide is fitted here: CSS has no way
          // to say it, and the table is the only thing that can be made
          // narrower without changing what is in it.
          width: setup.fitToPage && setup.fitToWidth !== null ? '100%' : 'auto',
          tableLayout: 'auto',
        }}
      >
        {heading.length > 0 && (
          <thead>
            {heading.map((row) => (
              <tr key={`head-${String(row)}`}>
                {columns.map((column) => (
                  <Cell
                    key={column}
                    open={open}
                    sheet={sheet}
                    row={row}
                    column={column}
                    setup={setup}
                  />
                ))}
              </tr>
            ))}
          </thead>
        )}
        <tbody>
          {body.map((row) => (
            <tr key={row}>
              {columns.map((column) => (
                <Cell
                  key={column}
                  open={open}
                  sheet={sheet}
                  row={row}
                  column={column}
                  setup={setup}
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Cell({
  open,
  sheet,
  row,
  column,
  setup,
}: {
  open: OpenWorkbook
  sheet: OpenSheet
  row: number
  column: number
  setup: PageSetup
}) {
  const cell = sheet.cells.rows.get(row)?.get(column) ?? null
  const styles = open.styles
  const resolved = styles === null ? null : resolveStyle(styles, cell?.style ?? null)

  const text = (() => {
    if (cell?.value == null) return ''
    if (cell.type === 's') return open.strings[Number(cell.value)]?.text ?? ''
    if (cell.type === 'inlineStr' || cell.type === 'str' || cell.type === 'e') return cell.value
    if (cell.type === 'b') return cell.value === '1' ? 'TRUE' : 'FALSE'

    const number = Number(cell.value)
    if (!Number.isFinite(number)) return cell.value
    if (styles === null || resolved === null) return cell.value

    const code = formatCodeOf(styles, resolved.numberFormat)
    return formatValue(number, code, { date1904: open.workbook.date1904 }).text
  })()

  const hex = (color: Parameters<typeof resolveColor>[0]) => {
    const six = resolveColor(color, open.palette)
    return six === null ? undefined : `#${six}`
  }

  const fill = resolved?.fill ?? null
  const font = resolved?.font ?? null
  const alignment = resolved?.alignment ?? null
  const numeric = cell?.type === 'n'

  return (
    <td
      style={{
        // Gridlines are printed only where the sheet asks for them, which is
        // the setting people forget they have not set.
        border: setup.gridLines ? '0.5pt solid #bbbbbb' : undefined,
        padding: '1pt 3pt',
        whiteSpace: 'pre',
        fontWeight: font?.bold === true ? 'bold' : undefined,
        fontStyle: font?.italic === true ? 'italic' : undefined,
        fontFamily: font?.name ?? undefined,
        color: font === null ? undefined : hex(font.color),
        background:
          fill === null || fill.pattern === null || fill.pattern === 'none'
            ? undefined
            : hex(fill.foreground),
        // A number goes right unless somebody said otherwise, which is the
        // rule the grid follows and the reason a column of figures lines up.
        textAlign:
          alignment?.horizontal == null
            ? numeric
              ? 'right'
              : undefined
            : (alignment.horizontal as 'left' | 'right' | 'center'),
      }}
    >
      {text}
    </td>
  )
}
