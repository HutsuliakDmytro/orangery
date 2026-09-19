import { useCallback, useEffect, useMemo, useRef } from 'react'
import { DataGrid } from '@orangery/grid'
import type { CellAddress, CellStyle } from '@orangery/grid'
import {
  cellAt,
  formatCodeOf,
  indexToColumn,
  mergeAt,
  resolveColor,
  resolveStyle,
  widthOfColumn,
} from '@orangery/ooxml-spreadsheet'
import type { Cell, ResolvedStyle } from '@orangery/ooxml-spreadsheet'
import { formatValue } from '@orangery/numfmt'
import type { OpenSheet, OpenWorkbook } from '../document/workbook'

/**
 * A worksheet, drawn.
 *
 * The seam between a file and a grid. Everything a workbook knows — the shared
 * strings, the style cascade, the theme, the format codes — is answered here,
 * one cell at a time, and the grid is handed strings and colours.
 *
 * Answered on demand rather than computed on open: a sheet has a million cells
 * and a window shows two hundred, and formatting the rest would be work for
 * something nobody will look at. What that costs is a lookup per visible cell
 * per repaint, which is why the expensive halves — the style cascade and the
 * format code — are cached by the index they came from.
 */

/** Excel counts widths in characters; a character is about seven points wide. */
const POINTS_PER_CHARACTER = 7
const DEFAULT_COLUMN_WIDTH = 8.43
const DEFAULT_ROW_HEIGHT = 15

export interface SheetViewProps {
  open: OpenWorkbook
  sheet: OpenSheet
  width: number
  height: number
}

export function SheetView({ open, sheet, width, height }: SheetViewProps) {
  const { styles, strings, palette } = open

  /**
   * The style a cell's index stands for, worked out once per index.
   *
   * A sheet of a hundred thousand cells has a dozen styles between them, and
   * following the cascade for each cell on every repaint would be the same
   * answer computed ten thousand times a second.
   */
  const resolved = useRef(new Map<number, ResolvedStyle>())

  // Emptied when the styles themselves change, which is the only time an
  // answer already worked out could be the wrong one.
  useEffect(() => {
    resolved.current = new Map()
  }, [styles])

  const styleOf = useCallback(
    (index: number | null): ResolvedStyle | null => {
      if (styles === null) return null

      const at = index ?? 0
      const held = resolved.current.get(at)
      if (held !== undefined) return held

      const made = resolveStyle(styles, at)
      resolved.current.set(at, made)
      return made
    },
    [styles],
  )

  const cellFor = useCallback(
    (address: CellAddress): Cell | null => cellAt(sheet.cells, address),
    [sheet.cells],
  )

  /**
   * What a cell shows.
   *
   * The type says how to read the value — a shared string is an index into the
   * table, and reading it as a number is the classic way to show 4 where Q1
   * was meant — and the format says what to make of it.
   */
  const valueAt = useCallback(
    (address: CellAddress): string | null => {
      const cell = cellFor(address)
      if (cell === null || cell.value === null) return null

      if (cell.type === 's') {
        const index = Number(cell.value)
        return strings[index] ?? ''
      }
      if (cell.type === 'inlineStr' || cell.type === 'str') return cell.value
      if (cell.type === 'e') return cell.value
      if (cell.type === 'b') return cell.value === '1' ? 'TRUE' : 'FALSE'

      const number = Number(cell.value)
      if (!Number.isFinite(number)) return cell.value

      const style = styleOf(cell.style)
      const code =
        styles === null || style === null ? null : formatCodeOf(styles, style.numberFormat)

      return formatValue(number, code, { date1904: open.workbook.date1904 }).text
    },
    [cellFor, open.workbook.date1904, strings, styleOf, styles],
  )

  const styleAt = useCallback(
    (address: CellAddress): CellStyle | null => {
      const cell = cellFor(address)
      const style = styleOf(cell?.style ?? null)
      if (style === null) return null

      const hex = (color: Parameters<typeof resolveColor>[0]) => {
        const six = resolveColor(color, palette)
        return six === null ? undefined : `#${six}`
      }

      // A pattern of `none` is no fill at all, which is not a white one: the
      // cell shows whatever is behind it, and painting it white would hide the
      // gridlines under it.
      const fill = style.fill
      const background =
        fill === null || fill.pattern === null || fill.pattern === 'none'
          ? undefined
          : hex(fill.foreground)

      const font = style.font
      const size = font?.size ?? 11
      const family = font?.name ?? 'Calibri'

      return {
        font: `${font?.italic === true ? 'italic ' : ''}${font?.bold === true ? 'bold ' : ''}${String(size)}px ${family}`,
        color: hex(font?.color ?? null),
        background,
        align:
          style.alignment?.horizontal === 'center'
            ? 'center'
            : style.alignment?.horizontal === 'right'
              ? 'right'
              : style.alignment?.horizontal === 'left'
                ? 'left'
                : undefined,
        verticalAlign:
          style.alignment?.vertical === 'top'
            ? 'top'
            : style.alignment?.vertical === 'center'
              ? 'middle'
              : undefined,
        indent: style.alignment?.indent ?? 0,
        wrap: style.alignment?.wrapText ?? false,
        borders: {
          left:
            hex(style.border.left.color) ?? (style.border.left.style === null ? null : '#B2B2B2'),
          right:
            hex(style.border.right.color) ?? (style.border.right.style === null ? null : '#B2B2B2'),
          top: hex(style.border.top.color) ?? (style.border.top.style === null ? null : '#B2B2B2'),
          bottom:
            hex(style.border.bottom.color) ??
            (style.border.bottom.style === null ? null : '#B2B2B2'),
        },
      }
    },
    [cellFor, palette, styleOf],
  )

  const merged = useCallback(
    (address: CellAddress) => {
      const range = mergeAt(sheet.sheet, address)
      if (range === null) return null

      return {
        cell: { row: range.from.row, column: range.from.column },
        rows: range.to.row - range.from.row + 1,
        columns: range.to.column - range.from.column + 1,
      }
    },
    [sheet.sheet],
  )

  /** As far as the cells reach, with room to scroll past them as Excel has. */
  const extent = useMemo(() => {
    const rows = Math.max(...[...sheet.cells.rows.keys()].map((row) => row + 1), 0)
    const columns = Math.max(
      ...[...sheet.cells.rows.values()].flatMap((cells) => [...cells.keys()].map((one) => one + 1)),
      0,
    )

    return { rows: Math.max(rows + 50, 100), columns: Math.max(columns + 5, 26) }
  }, [sheet.cells])

  const metrics = useMemo(() => {
    const widths = Array.from({ length: extent.columns }, (_, column) => {
      const stated = widthOfColumn(sheet.sheet, column) ?? DEFAULT_COLUMN_WIDTH
      return Math.round(stated * POINTS_PER_CHARACTER)
    })

    return {
      columnWidth: Math.round(DEFAULT_COLUMN_WIDTH * POINTS_PER_CHARACTER),
      columnWidths: widths,
      rowHeight: Math.round(sheet.sheet.format.defaultRowHeight ?? DEFAULT_ROW_HEIGHT) + 5,
      rowHeights: rowHeights(sheet),
      headerWidth: 44,
      headerHeight: 22,
    }
  }, [extent.columns, sheet])

  const frozen = useMemo(() => {
    const panes = sheet.sheet.view.panes
    // A split moves both panes and is not a freeze; nothing here holds rows
    // still for it, so it is drawn as an ordinary sheet until it is.
    return panes === null || panes.split ? null : { rows: panes.rows, columns: panes.columns }
  }, [sheet.sheet.view.panes])

  return (
    <DataGrid
      label={sheet.name}
      rows={extent.rows}
      columns={extent.columns}
      width={width}
      height={height}
      metrics={metrics}
      frozen={frozen}
      columnHeader={(column) => indexToColumn(column)}
      rowHeader={(row) => String(row + 1)}
      valueAt={valueAt}
      styleAt={styleAt}
      mergeAt={merged}
    />
  )
}

/** The heights a sheet states for its rows, as the grid counts them. */
function rowHeights(sheet: OpenSheet): number[] {
  const stated = [...sheet.cells.properties.entries()].filter(([, row]) => row.height !== null)
  if (stated.length === 0) return []

  const last = Math.max(...stated.map(([index]) => index))
  const fallback = Math.round(sheet.sheet.format.defaultRowHeight ?? DEFAULT_ROW_HEIGHT) + 5

  return Array.from({ length: last + 1 }, (_, index) => {
    const height = sheet.cells.properties.get(index)?.height
    return height === null || height === undefined ? fallback : Math.round(height) + 5
  })
}
