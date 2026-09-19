import { EMU_PER_PIXEL, textOfBody, visibleCells } from '@orangery/ooxml-drawingml'
import type { ColorContext, Table, TableCell } from '@orangery/ooxml-drawingml'
import { partsFor } from '@orangery/ooxml-presentation'
import type { TableStyle } from '@orangery/ooxml-presentation'
import { fillPaint, linePaint } from './paint'

/**
 * A table on a slide.
 *
 * Rows and columns give the grid; a merged block is drawn once, by the cell
 * that owns it, spanning the widths and heights it swallowed. The cells it
 * swallowed are skipped here and still written back — they are part of the
 * file, just not part of the picture.
 *
 * Row heights are what the file states. PowerPoint grows a row to fit its text
 * and writes the grown height back, so the stated height is right for a deck
 * nobody has edited since; laying text out to find a taller one is the autofit
 * work, not this.
 */

interface Placed {
  /** Where in the grid it is, which is what a click on it means. */
  row: number
  column: number
  cell: TableCell
  x: number
  y: number
  width: number
  height: number
  key: string
}

function place(table: Table): Placed[] {
  const columnStarts = table.columns.reduce<number[]>(
    (starts, width, index) => [...starts, (starts[index] ?? 0) + width],
    [0],
  )
  const rowStarts = table.rows.reduce<number[]>(
    (starts, row, index) => [...starts, (starts[index] ?? 0) + (row.height ?? 0)],
    [0],
  )

  return table.rows.flatMap((row, rowIndex) => {
    // A cell's column is its position in the row, counting the merged ones:
    // they are present, which is what keeps the grid lining up.
    let column = 0

    return row.cells.flatMap((cell) => {
      const at = column
      column += cell.gridSpan
      if (!visibleCells(row).includes(cell)) return []

      const left = columnStarts[at] ?? 0
      const right = columnStarts[Math.min(at + cell.gridSpan, table.columns.length)] ?? left
      const top = rowStarts[rowIndex] ?? 0
      const bottom = rowStarts[Math.min(rowIndex + cell.rowSpan, table.rows.length)] ?? top

      return [
        {
          cell,
          x: left,
          y: top,
          width: right - left,
          height: bottom - top,
          key: `${String(rowIndex)}-${String(at)}`,
          row: rowIndex,
          column: at,
        },
      ]
    })
  })
}

export function TableView({
  table,
  x,
  y,
  context,
  style,
  selection,
  onPickCell,
}: {
  table: Table
  x: number
  y: number
  context: ColorContext
  /** What the table's style says, when the deck says anything at all. */
  style?: TableStyle
  /** The block of cells picked out, in grid coordinates. */
  selection?: { row: number; column: number; toRow: number; toColumn: number } | null
  /** Given the cell clicked and whether the click was extending a block. */
  onPickCell?: (at: { row: number; column: number }, extend: boolean) => void
}) {
  const within = (placed: { row: number; column: number }) => {
    if (selection == null) return false
    const rows = [selection.row, selection.toRow].sort((a, b) => a - b)
    const columns = [selection.column, selection.toColumn].sort((a, b) => a - b)
    return (
      placed.row >= (rows[0] ?? 0) &&
      placed.row <= (rows[1] ?? 0) &&
      placed.column >= (columns[0] ?? 0) &&
      placed.column <= (columns[1] ?? 0)
    )
  }

  return (
    <g transform={`translate(${String(x)} ${String(y)})`}>
      {place(table).map((placed) => {
        // A cell's own fill wins; the style only says what an unstated cell is.
        const fromStyle =
          style === undefined
            ? null
            : (partsFor(style, table.properties, {
                row: placed.row,
                column: placed.column,
                rows: table.rows.length,
              })
                .map((part) => part.fill)
                .filter((one) => one !== null)
                .at(-1) ?? null)

        const fill = fillPaint(
          placed.cell.properties?.fill ?? fromStyle,
          context,
          `cell-${placed.key}`,
        )

        const bold =
          style === undefined
            ? false
            : partsFor(style, table.properties, {
                row: placed.row,
                column: placed.column,
                rows: table.rows.length,
              }).some((part) => part.bold === true)
        const border = linePaint(placed.cell.properties?.borders.top ?? null, context, (emu) => emu)

        return (
          <g key={placed.key}>
            <rect
              x={placed.x}
              y={placed.y}
              width={placed.width}
              height={placed.height}
              fill={fill.paint}
              fillOpacity={fill.opacity}
              {...(border.stroke === 'none'
                ? // No border stated: a hairline, so the grid is legible rather
                  // than a block of text with no structure.
                  { stroke: '#D9D9D9', strokeWidth: 9525 }
                : border)}
            />
            <foreignObject x={placed.x} y={placed.y} width={placed.width} height={placed.height}>
              {/* Laid out in pixels and scaled back, for the reason the text of
                  a shape is: a cell's words are text, and text in EMU is past
                  what Blink will lay out. */}
              <div
                style={{
                  width: placed.width / EMU_PER_PIXEL,
                  height: placed.height / EMU_PER_PIXEL,
                  transform: `scale(${String(EMU_PER_PIXEL)})`,
                  transformOrigin: '0 0',
                  padding: 45720 / EMU_PER_PIXEL,
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems:
                    placed.cell.properties?.anchor === 'ctr'
                      ? 'center'
                      : placed.cell.properties?.anchor === 'b'
                        ? 'flex-end'
                        : 'flex-start',
                  fontSize: '18pt',
                  fontWeight: bold ? 700 : undefined,
                  overflow: 'hidden',
                }}
              >
                {placed.cell.text === null ? '' : textOfBody(placed.cell.text)}
              </div>
            </foreignObject>
            {onPickCell !== undefined && (
              <rect
                x={placed.x}
                y={placed.y}
                width={placed.width}
                height={placed.height}
                fill={within(placed) ? 'var(--accent)' : 'transparent'}
                fillOpacity={within(placed) ? 0.2 : 1}
                role="button"
                aria-label={`Cell ${String(placed.row + 1)}, ${String(placed.column + 1)}`}
                onPointerDown={(event) => {
                  event.stopPropagation()
                  onPickCell({ row: placed.row, column: placed.column }, event.shiftKey)
                }}
              />
            )}
          </g>
        )
      })}
    </g>
  )
}
