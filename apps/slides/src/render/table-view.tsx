import { textOfBody, visibleCells } from '@orangery/ooxml-drawingml'
import type { ColorContext, Table, TableCell } from '@orangery/ooxml-drawingml'
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
}: {
  table: Table
  x: number
  y: number
  context: ColorContext
}) {
  return (
    <g transform={`translate(${String(x)} ${String(y)})`}>
      {place(table).map((placed) => {
        const fill = fillPaint(placed.cell.properties?.fill ?? null, context, `cell-${placed.key}`)
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
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  padding: 45720,
                  boxSizing: 'border-box',
                  display: 'flex',
                  alignItems:
                    placed.cell.properties?.anchor === 'ctr'
                      ? 'center'
                      : placed.cell.properties?.anchor === 'b'
                        ? 'flex-end'
                        : 'flex-start',
                  fontSize: 18 * 12700,
                  overflow: 'hidden',
                }}
              >
                {placed.cell.text === null ? '' : textOfBody(placed.cell.text)}
              </div>
            </foreignObject>
          </g>
        )
      })}
    </g>
  )
}
