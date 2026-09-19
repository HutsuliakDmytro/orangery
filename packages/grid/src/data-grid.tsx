import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  cellAtPoint,
  rectangleOfCell,
  scrollToCell,
  totalHeight,
  totalWidth,
  visibleColumns,
  visibleRows,
  widthOfColumn,
} from './layout'
import type { CellAddress, GridMetrics, Viewport } from './layout'

/**
 * A grid of cells, drawn rather than built.
 *
 * Cells are painted on a canvas and only the visible ones are painted at all.
 * A table of DOM elements is the obvious way to do this and the wrong one: a
 * sheet is a million rows by sixteen thousand columns, and a browser asked for
 * that many elements stops being a browser. Here the same surface serves four
 * columns in a chart's data editor and a whole worksheet later, because the
 * cost is the size of the window rather than the size of the data.
 *
 * Exactly one cell is a DOM element: the one being edited. It is a real input
 * over the canvas, so typing, selection, composition and the platform's own
 * text behaviour are the platform's, not ours.
 */

export interface DataGridProps {
  rows: number
  columns: number
  /** What to draw in a cell. Null is a blank, which is not the same as a nought. */
  valueAt: (cell: CellAddress) => string | null
  /** The letters along the top; A, B, C unless the caller says otherwise. */
  columnHeader?: (column: number) => string
  /** The numbers down the left. */
  rowHeader?: (row: number) => string
  /** Called when a cell is committed. Without it the grid is read-only. */
  onChange?: (cell: CellAddress, text: string) => void
  /** Cells this says no to are selectable and not editable. */
  editable?: (cell: CellAddress) => boolean
  width: number
  height: number
  label: string
  metrics?: Partial<GridMetrics>
}

const DEFAULTS: GridMetrics = {
  rowHeight: 22,
  columnWidth: 84,
  headerWidth: 44,
  headerHeight: 22,
}

const COLORS = {
  grid: '#DADADA',
  header: '#F5F5F5',
  headerText: '#666666',
  text: '#111111',
  selection: '#FF7A00',
  background: '#FFFFFF',
}

/** A, B, … Z, AA — the names a spreadsheet gives its columns. */
export function columnName(index: number): string {
  const letters: string[] = []
  for (let left = index + 1; left > 0; left = Math.floor((left - 1) / 26)) {
    letters.unshift(String.fromCharCode(64 + ((left - 1) % 26) + 1))
  }

  return letters.join('')
}

export function DataGrid({
  rows,
  columns,
  valueAt,
  columnHeader = columnName,
  rowHeader = (row) => String(row + 1),
  onChange,
  editable,
  width,
  height,
  label,
  metrics: overrides,
}: DataGridProps) {
  const metrics = useMemo<GridMetrics>(() => ({ ...DEFAULTS, ...overrides }), [overrides])

  const canvas = useRef<HTMLCanvasElement | null>(null)
  const surface = useRef<HTMLDivElement | null>(null)
  const [scroll, setScroll] = useState({ x: 0, y: 0 })
  const [selected, setSelected] = useState<CellAddress>({ row: 0, column: 0 })
  const [editing, setEditing] = useState<{ cell: CellAddress; text: string } | null>(null)

  const viewport: Viewport = { scrollX: scroll.x, scrollY: scroll.y, width, height }

  const draw = useCallback(() => {
    const context = canvas.current?.getContext('2d')
    if (!context) return

    const ratio = window.devicePixelRatio || 1
    context.setTransform(ratio, 0, 0, ratio, 0, 0)
    context.clearRect(0, 0, width, height)
    context.fillStyle = COLORS.background
    context.fillRect(0, 0, width, height)

    const view: Viewport = { scrollX: scroll.x, scrollY: scroll.y, width, height }
    const seenRows = visibleRows(metrics, view, rows)
    const seenColumns = visibleColumns(metrics, view, columns)

    context.font = '12px -apple-system, system-ui, sans-serif'
    context.textBaseline = 'middle'

    // The cells, then the lines over them, then the headers over both: a
    // header is a fixed strip and has to cover whatever scrolled under it.
    for (let row = seenRows.first; row <= seenRows.last; row += 1) {
      for (let column = seenColumns.first; column <= seenColumns.last; column += 1) {
        const rect = rectangleOfCell(metrics, view, { row, column })
        const text = valueAt({ row, column })
        if (text === null || text === '') continue

        context.fillStyle = COLORS.text
        context.save()
        context.beginPath()
        context.rect(rect.x, rect.y, rect.width, rect.height)
        context.clip()
        context.fillText(text, rect.x + 4, rect.y + rect.height / 2)
        context.restore()
      }
    }

    context.strokeStyle = COLORS.grid
    context.lineWidth = 1
    context.beginPath()

    for (let row = seenRows.first; row <= seenRows.last + 1; row += 1) {
      const y = metrics.headerHeight + metrics.rowHeight * row - scroll.y
      context.moveTo(metrics.headerWidth, y)
      context.lineTo(width, y)
    }

    for (let column = seenColumns.first; column <= seenColumns.last + 1; column += 1) {
      const rect = rectangleOfCell(metrics, view, { row: 0, column })
      context.moveTo(rect.x, metrics.headerHeight)
      context.lineTo(rect.x, height)
    }

    context.stroke()

    // Headers.
    context.fillStyle = COLORS.header
    context.fillRect(0, 0, width, metrics.headerHeight)
    context.fillRect(0, 0, metrics.headerWidth, height)
    context.fillStyle = COLORS.headerText

    for (let column = seenColumns.first; column <= seenColumns.last; column += 1) {
      const rect = rectangleOfCell(metrics, view, { row: 0, column })
      context.fillText(columnHeader(column), rect.x + 4, metrics.headerHeight / 2)
    }

    for (let row = seenRows.first; row <= seenRows.last; row += 1) {
      const y = metrics.headerHeight + metrics.rowHeight * row - scroll.y
      context.fillText(rowHeader(row), 4, y + metrics.rowHeight / 2)
    }

    // The selection last, so nothing draws over it.
    const rect = rectangleOfCell(metrics, view, selected)
    context.strokeStyle = COLORS.selection
    context.lineWidth = 2
    context.strokeRect(rect.x, rect.y, rect.width, rect.height)
  }, [
    columnHeader,
    columns,
    height,
    metrics,
    rowHeader,
    rows,
    scroll.x,
    scroll.y,
    selected,
    valueAt,
    width,
  ])

  useLayoutEffect(() => {
    const element = canvas.current
    if (element === null) return

    // Drawn at the device's own resolution, or every line is a grey smear on a
    // Retina screen.
    const ratio = window.devicePixelRatio || 1
    element.width = Math.round(width * ratio)
    element.height = Math.round(height * ratio)
    draw()
  }, [draw, height, width])

  const canEdit = useCallback(
    (cell: CellAddress) => onChange !== undefined && (editable?.(cell) ?? true),
    [editable, onChange],
  )

  const move = useCallback(
    (cell: CellAddress) => {
      const wanted = {
        row: Math.max(0, Math.min(cell.row, rows - 1)),
        column: Math.max(0, Math.min(cell.column, columns - 1)),
      }

      setSelected(wanted)
      const to = scrollToCell(metrics, { ...viewport }, wanted)
      setScroll({ x: to.scrollX, y: to.scrollY })
    },
    // The viewport is rebuilt on each render from scroll and size, which are
    // already dependencies of what this reads.
    [columns, metrics, rows, viewport],
  )

  const commit = useCallback(
    (text: string, cell: CellAddress) => {
      closing.current = true
      setEditing(null)
      // The input is about to go; without this the focus goes with it and the
      // next arrow key lands on the page rather than on the grid.
      surface.current?.focus()
      onChange?.(cell, text)
    },
    [onChange],
  )

  /**
   * Whether the edit being closed has already been dealt with.
   *
   * Enter, Tab and Escape all take the focus back to the grid, and blurring
   * the input is what commits it — so without this, finishing an edit by any
   * of them would hand the same text over twice, and a cancelled one would be
   * saved on its way out. A caller that writes into an undo history would see
   * one edit as two.
   */
  const closing = useRef(false)

  const stopEditing = useCallback(() => {
    closing.current = true
    setEditing(null)
    surface.current?.focus()
  }, [])

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editing !== null) return

    const step: Record<string, CellAddress> = {
      ArrowDown: { row: selected.row + 1, column: selected.column },
      ArrowUp: { row: selected.row - 1, column: selected.column },
      ArrowRight: { row: selected.row, column: selected.column + 1 },
      ArrowLeft: { row: selected.row, column: selected.column - 1 },
      Enter: { row: selected.row + 1, column: selected.column },
      Tab: { row: selected.row, column: selected.column + (event.shiftKey ? -1 : 1) },
    }

    const wanted = step[event.key]
    if (wanted !== undefined) {
      event.preventDefault()
      move(wanted)
      return
    }

    if (event.key === 'F2' && canEdit(selected)) {
      event.preventDefault()
      setEditing({ cell: selected, text: valueAt(selected) ?? '' })
      return
    }

    // Delete empties the cell, as it does in every spreadsheet. Handed over as
    // empty text rather than as a value of its own: what emptying a cell means
    // is the caller's to decide, and for a chart it is a gap rather than a
    // nought.
    if ((event.key === 'Delete' || event.key === 'Backspace') && canEdit(selected)) {
      event.preventDefault()
      if (valueAt(selected) !== null && valueAt(selected) !== '') onChange?.(selected, '')
      return
    }

    // Typing into a selected cell replaces what is in it, as every spreadsheet
    // does: the first keystroke is the first character, not a lost one.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && canEdit(selected)) {
      event.preventDefault()
      setEditing({ cell: selected, text: event.key })
    }
  }

  const editor = editing === null ? null : rectangleOfCell(metrics, viewport, editing.cell)

  return (
    <div
      ref={surface}
      role="grid"
      aria-label={label}
      aria-rowcount={rows}
      aria-colcount={columns}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onScroll={(event) => {
        setScroll({ x: event.currentTarget.scrollLeft, y: event.currentTarget.scrollTop })
      }}
      style={{ position: 'relative', width, height, overflow: 'auto', outline: 'none' }}
    >
      {/* Sized to the whole grid so the scrollbars mean what they say. */}
      <div
        style={{
          width: totalWidth(metrics, columns),
          height: totalHeight(metrics, rows),
          position: 'relative',
        }}
        onPointerDown={(event) => {
          const box = event.currentTarget.parentElement?.getBoundingClientRect()
          if (box === undefined) return

          const cell = cellAtPoint(
            metrics,
            viewport,
            { x: event.clientX - box.left, y: event.clientY - box.top },
            { rows, columns },
          )
          if (cell !== null) move(cell)
        }}
        onDoubleClick={() => {
          if (canEdit(selected)) setEditing({ cell: selected, text: valueAt(selected) ?? '' })
        }}
      >
        <canvas
          ref={canvas}
          // Pinned to the corner of the window rather than the content, so the
          // painting follows the scroll instead of scrolling away with it.
          style={{
            position: 'sticky',
            top: 0,
            left: 0,
            width,
            height,
            display: 'block',
          }}
        />
      </div>

      {editing !== null && editor !== null && (
        <input
          autoFocus
          aria-label={`${columnHeader(editing.cell.column)}${String(editing.cell.row + 1)}`}
          value={editing.text}
          onChange={(event) => {
            setEditing({ cell: editing.cell, text: event.target.value })
          }}
          onBlur={() => {
            if (closing.current) {
              closing.current = false
              return
            }
            commit(editing.text, editing.cell)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              commit(editing.text, editing.cell)
              move({ row: editing.cell.row + 1, column: editing.cell.column })
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              stopEditing()
            }
            if (event.key === 'Tab') {
              event.preventDefault()
              commit(editing.text, editing.cell)
              move({
                row: editing.cell.row,
                column: editing.cell.column + (event.shiftKey ? -1 : 1),
              })
            }
          }}
          style={{
            position: 'absolute',
            left: editor.x,
            top: editor.y,
            width: widthOfColumn(metrics, editing.cell.column),
            height: metrics.rowHeight,
            font: '12px -apple-system, system-ui, sans-serif',
            border: `2px solid ${COLORS.selection}`,
            padding: '0 2px',
            outline: 'none',
            background: COLORS.background,
            color: COLORS.text,
          }}
        />
      )}

      {/* What a screen reader has instead of the painting. */}
      <span
        aria-live="polite"
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          overflow: 'hidden',
          clipPath: 'inset(50%)',
        }}
      >
        {`${columnHeader(selected.column)}, row ${rowHeader(selected.row)}: ${
          valueAt(selected) ?? 'empty'
        }`}
      </span>
    </div>
  )
}

/** Keeps the canvas in step with a value that changed outside a render. */
export function useRedrawOn(value: unknown, redraw: () => void): void {
  useEffect(redraw, [redraw, value])
}
