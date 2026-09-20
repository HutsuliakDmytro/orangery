import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  cellAtPoint,
  frozenSize,
  headerAtPoint,
  heightOfRow,
  rectangleOfCell,
  scrollToCell,
  totalHeight,
  totalWidth,
  visibleColumns,
  visibleRows,
  widthOfColumn,
} from './layout'
import type { CellAddress, FrozenPanes, GridMetrics, Viewport } from './layout'
import {
  boundsOf,
  coversColumn,
  coversRow,
  edgeFrom,
  everything,
  extendedTo,
  lastRange,
  nextInSelection,
  selectedCount,
  singleCell,
  stepFrom,
  wholeColumns,
  wholeRows,
  withRange,
} from './selection'
import type { Direction, GridSelection, Order } from './selection'
import type { CellBorders, CellStyle } from './cell-style'
import { ICON_GUTTER, drawIcon } from './icon'
import { drawCellText } from './text'

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
  /**
   * What a cell looks like. Resolved by the caller, because what a style means
   * is a question about the file rather than about the grid.
   */
  styleAt?: (cell: CellAddress) => CellStyle | null
  /**
   * The cell a merged range starts at, for any cell inside it.
   *
   * Merged cells are drawn once, from their top-left corner, across the whole
   * range: a heading merged across four columns is one box with one string in
   * it, and drawing each cell separately would clip it four times.
   */
  mergeAt?: (cell: CellAddress) => { cell: CellAddress; rows: number; columns: number } | null
  /** Rows and columns held still at the top and left. */
  frozen?: FrozenPanes | null
  /**
   * What is drawn over the cells rather than in them.
   *
   * A chart or a picture on a sheet is anchored to cells and belongs to none
   * of them, and it is a real element rather than paint — an SVG chart and an
   * `<img>` are things the platform already knows how to draw well. The grid
   * owns the scroll, so it is the grid that has to say where the layer sits;
   * what goes in it is the caller's.
   */
  overlay?: (view: { scrollX: number; scrollY: number; metrics: GridMetrics }) => React.ReactNode
  /**
   * The cell the pointer is over, or null once it leaves.
   *
   * Hovering is the grid's to know — it owns the scroll and the geometry — and
   * what to do about it is the caller's. A note shown on hover is the reason
   * this exists.
   */
  onHoverCell?: (cell: CellAddress | null) => void
  /**
   * What is selected, when the caller wants to say.
   *
   * Left out, the grid keeps its own and reports every change. Given, the
   * caller decides — which is what a name box needs, since typing `B12` into
   * one has to move a selection the grid did not move itself.
   */
  selection?: GridSelection
  onSelectionChange?: (selection: GridSelection) => void
  /**
   * Called with everything selected when Delete is pressed.
   *
   * Without it, Delete empties the one cell the cursor is on, which is all a
   * chart's data editor has ever needed. With it, clearing a selection is one
   * thing the caller can record as one thing.
   */
  onDelete?: (selection: GridSelection) => void
  /**
   * Called on `Mod+Enter` with everything selected and what was typed.
   *
   * Filling a block with one value is one thing somebody did; handing over the
   * selection rather than a cell at a time is what lets the caller record it
   * as one.
   */
  onFill?: (selection: GridSelection, text: string) => void
  /**
   * How much larger everything is drawn; 1 is unzoomed.
   *
   * Folded into the measurements rather than applied to the canvas, so that
   * the arithmetic the grid does about where a click landed and how far there
   * is to scroll is done in the same units it paints in. A canvas transform
   * would have made the painting right and every other answer wrong.
   */
  zoom?: number
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
  /** Over the cells, so what is under a selection stays readable. */
  selectionFill: 'rgba(255, 122, 0, 0.12)',
  /** A header whose row or column is selected, and one merely touched by it. */
  headerSelected: '#FFE2C6',
  headerTouched: '#E4E4E4',
  background: '#FFFFFF',
}

/**
 * The lines a cell states around itself.
 *
 * Drawn per cell rather than per edge, which means a shared edge is drawn
 * twice — once by each neighbour. That is what the format describes and what
 * Excel does: the cell below can state a different line from the cell above,
 * and the last one drawn is the one that shows.
 */
function drawBorders(
  context: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  borders: CellBorders,
): void {
  const edges: [string | null, number, number, number, number][] = [
    [borders.top, rect.x, rect.y, rect.x + rect.width, rect.y],
    [borders.bottom, rect.x, rect.y + rect.height, rect.x + rect.width, rect.y + rect.height],
    [borders.left, rect.x, rect.y, rect.x, rect.y + rect.height],
    [borders.right, rect.x + rect.width, rect.y, rect.x + rect.width, rect.y + rect.height],
  ]

  for (const [color, x1, y1, x2, y2] of edges) {
    if (color === null) continue

    context.strokeStyle = color
    context.lineWidth = 1
    context.beginPath()
    context.moveTo(x1, y1)
    context.lineTo(x2, y2)
    context.stroke()
  }
}

export { zoomed as zoomedMetrics }

/**
 * Every measurement larger or smaller by the same factor.
 *
 * Including the headers: a zoomed sheet whose row numbers stayed the old size
 * would have them creeping under the cells beside them.
 */
function zoomed(metrics: GridMetrics, zoom: number): GridMetrics {
  if (zoom === 1) return metrics

  return {
    rowHeight: metrics.rowHeight * zoom,
    columnWidth: metrics.columnWidth * zoom,
    columnWidths: metrics.columnWidths?.map((width) => width * zoom),
    rowHeights: metrics.rowHeights?.map((height) => height * zoom),
    headerWidth: metrics.headerWidth * zoom,
    headerHeight: metrics.headerHeight * zoom,
  }
}

/** A CSS font shorthand with its size scaled, which is all a zoom does to it. */
const resized = (font: string, zoom: number): string =>
  zoom === 1
    ? font
    : font.replace(/(\d*\.?\d+)px/u, (_, size: string) => `${String(Number(size) * zoom)}px`)

/**
 * Keeps the pointer's events coming to this element while a drag is on.
 *
 * Guarded, because not every environment has it — jsdom does not, and a
 * webview without it still drags; the range simply stops growing once the
 * pointer leaves the grid, which is the behaviour capture exists to improve
 * rather than to enable.
 */
function holdPointer(element: Element, pointerId: number, hold: boolean): void {
  const target = element as Partial<Element>
  if (typeof target.setPointerCapture !== 'function') return

  if (hold) target.setPointerCapture(pointerId)
  else if (target.hasPointerCapture?.(pointerId) === true) target.releasePointerCapture?.(pointerId)
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
  styleAt,
  mergeAt,
  frozen = null,
  zoom = 1,
  overlay,
  onHoverCell,
  selection: given,
  onSelectionChange,
  onDelete,
  onFill,
}: DataGridProps) {
  const metrics = useMemo<GridMetrics>(
    () => zoomed({ ...DEFAULTS, ...overrides }, zoom),
    [overrides, zoom],
  )

  const canvas = useRef<HTMLCanvasElement | null>(null)
  const surface = useRef<HTMLDivElement | null>(null)
  const [scroll, setScroll] = useState({ x: 0, y: 0 })
  const [own, setOwn] = useState<GridSelection>(() => singleCell({ row: 0, column: 0 }))
  const selection = given ?? own
  const selected = selection.active

  /** Whether the pointer is dragging a range out. */
  const dragging = useRef(false)

  const selectedCells = useMemo(() => selectedCount(selection), [selection])
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
    const scrolling = {
      rows: visibleRows(metrics, view, rows, frozen),
      columns: visibleColumns(metrics, view, columns, frozen),
    }

    const held = frozen ?? { rows: 0, columns: 0 }
    const DEFAULT_FONT = resized('12px -apple-system, system-ui, sans-serif', zoom)

    context.font = DEFAULT_FONT
    context.textBaseline = 'middle'

    /**
     * Every row and column on screen, the held ones included.
     *
     * The frozen strip is drawn with the same code as the rest — it is the
     * same cells at a fixed offset — so a column keeps its width, its style
     * and its borders on both sides of the line.
     */
    const rowsOnScreen = [
      ...Array.from({ length: held.rows }, (_, index) => index),
      ...Array.from(
        { length: Math.max(scrolling.rows.last - scrolling.rows.first + 1, 0) },
        (_, index) => scrolling.rows.first + index,
      ),
    ]
    const columnsOnScreen = [
      ...Array.from({ length: held.columns }, (_, index) => index),
      ...Array.from(
        { length: Math.max(scrolling.columns.last - scrolling.columns.first + 1, 0) },
        (_, index) => scrolling.columns.first + index,
      ),
    ]

    /** A cell's box, grown to the whole merge when it starts one. */
    const boxOf = (cell: CellAddress) => {
      const rect = rectangleOfCell(metrics, view, cell, frozen)
      const merge = mergeAt?.(cell)
      if (merge === undefined || merge === null) return { rect, skip: false }

      // Only the corner draws; the cells swallowed by a merge draw nothing,
      // or the corner's text is clipped by the boxes it was merged with.
      if (merge.cell.row !== cell.row || merge.cell.column !== cell.column) {
        return { rect, skip: true }
      }

      const last = rectangleOfCell(
        metrics,
        view,
        { row: cell.row + merge.rows - 1, column: cell.column + merge.columns - 1 },
        frozen,
      )
      return {
        rect: {
          x: rect.x,
          y: rect.y,
          width: last.x + last.width - rect.x,
          height: last.y + last.height - rect.y,
        },
        skip: false,
      }
    }

    // What is behind the cells, then what is in them, then the lines, then the
    // headers over all of it: a header is a fixed strip and has to cover
    // whatever scrolled under it.
    for (const row of rowsOnScreen) {
      for (const column of columnsOnScreen) {
        const cell = { row, column }
        const style = styleAt?.(cell) ?? null
        const { rect, skip } = boxOf(cell)
        if (skip) continue

        if (style?.background !== undefined) {
          context.fillStyle = style.background
          context.fillRect(rect.x, rect.y, rect.width, rect.height)
        }

        // A bar goes over the fill and under the value: it is a picture of the
        // number, so the number has to stay readable on top of it.
        if (style?.bar !== undefined && style.bar.proportion > 0) {
          context.fillStyle = style.bar.color
          context.fillRect(
            rect.x + 1,
            rect.y + 2,
            Math.max(0, (rect.width - 2) * Math.min(1, style.bar.proportion)),
            Math.max(0, rect.height - 4),
          )
        }

        if (style?.icon !== undefined) {
          drawIcon(context, style.icon, rect.x + 3 * zoom, rect.y + rect.height / 2, zoom)
        }

        const text = valueAt(cell)

        if (text !== null && text !== '') {
          // An icon sits in the cell rather than beside it, so the text starts
          // after it. A right-aligned number is untouched: the icon is at the
          // other end, and moving the digits would break the column.
          drawCellText(
            context,
            text,
            rect,
            style === null ? null : { ...style, font: resized(style.font ?? DEFAULT_FONT, zoom) },
            {
              font: DEFAULT_FONT,
              color: COLORS.text,
              gutter: style?.icon === undefined ? 0 : ICON_GUTTER * zoom,
            },
          )
        }

        // Outside the text, because a bordered cell with nothing in it is
        // still a bordered cell — a ruled form is mostly those.
        if (style?.borders !== undefined) drawBorders(context, rect, style.borders)

        // Last of all, so nothing in the cell is drawn over it: a corner mark
        // that a wide value painted over would be a mark nobody sees.
        if (style?.corner !== undefined) {
          const side = 5 * zoom
          context.fillStyle = style.corner
          context.beginPath()
          context.moveTo(rect.x + rect.width - side, rect.y)
          context.lineTo(rect.x + rect.width, rect.y)
          context.lineTo(rect.x + rect.width, rect.y + side)
          context.closePath()
          context.fill()
        }
      }
    }

    context.font = DEFAULT_FONT

    context.strokeStyle = COLORS.grid
    context.lineWidth = 1
    context.beginPath()

    for (const row of rowsOnScreen) {
      const rect = rectangleOfCell(metrics, view, { row, column: 0 }, frozen)
      context.moveTo(metrics.headerWidth, rect.y)
      context.lineTo(width, rect.y)
      context.moveTo(metrics.headerWidth, rect.y + rect.height)
      context.lineTo(width, rect.y + rect.height)
    }

    for (const column of columnsOnScreen) {
      const rect = rectangleOfCell(metrics, view, { row: 0, column }, frozen)
      context.moveTo(rect.x, metrics.headerHeight)
      context.lineTo(rect.x, height)
      context.moveTo(rect.x + rect.width, metrics.headerHeight)
      context.lineTo(rect.x + rect.width, height)
    }

    context.stroke()

    /**
     * What is selected, over the cells and under the headers.
     *
     * A wash rather than a solid: a selected cell has to stay readable, since
     * the reason anybody selects a column of figures is to look at it.
     */
    for (const range of selection.ranges) {
      const bounds = boundsOf(range)
      const first = rectangleOfCell(
        metrics,
        view,
        { row: Math.max(bounds.top, 0), column: Math.max(bounds.left, 0) },
        frozen,
      )
      const last = rectangleOfCell(
        metrics,
        view,
        { row: Math.min(bounds.bottom, rows - 1), column: Math.min(bounds.right, columns - 1) },
        frozen,
      )

      context.fillStyle = COLORS.selectionFill
      context.fillRect(
        first.x,
        first.y,
        last.x + last.width - first.x,
        last.y + last.height - first.y,
      )

      // One cell, and it is the cursor: the outline below is already drawing
      // it, and a second one over the top would be a heavier line than any
      // other selection gets.
      const alone =
        bounds.top === bounds.bottom &&
        bounds.left === bounds.right &&
        bounds.top === selected.row &&
        bounds.left === selected.column
      if (alone) continue

      context.strokeStyle = COLORS.selection
      context.lineWidth = 1
      context.strokeRect(
        first.x,
        first.y,
        last.x + last.width - first.x,
        last.y + last.height - first.y,
      )
    }

    // The active cell is left unwashed: it is where a typed value would land,
    // and a person has to be able to tell it from the rest of the range.
    const activeRect = rectangleOfCell(metrics, view, selected, frozen)
    if (selectedCells > 1) {
      context.fillStyle = COLORS.background
      context.fillRect(
        activeRect.x + 1,
        activeRect.y + 1,
        activeRect.width - 1,
        activeRect.height - 1,
      )

      const style = styleAt?.(selected) ?? null
      if (style?.background !== undefined) {
        context.fillStyle = style.background
        context.fillRect(
          activeRect.x + 1,
          activeRect.y + 1,
          activeRect.width - 1,
          activeRect.height - 1,
        )
      }

      const text = valueAt(selected)
      if (text !== null && text !== '') {
        drawCellText(
          context,
          text,
          activeRect,
          style === null ? null : { ...style, font: resized(style.font ?? DEFAULT_FONT, zoom) },
          { font: DEFAULT_FONT, color: COLORS.text, gutter: 0 },
        )
      }
    }

    // Headers.
    context.fillStyle = COLORS.header
    context.fillRect(0, 0, width, metrics.headerHeight)
    context.fillRect(0, 0, metrics.headerWidth, height)

    for (const column of columnsOnScreen) {
      const rect = rectangleOfCell(metrics, view, { row: 0, column }, frozen)
      const whole = coversColumn(selection, column, rows)
      const touched =
        whole ||
        selection.ranges.some((range) => {
          const bounds = boundsOf(range)
          return column >= bounds.left && column <= bounds.right
        })

      if (touched) {
        context.fillStyle = whole ? COLORS.headerSelected : COLORS.headerTouched
        context.fillRect(rect.x, 0, rect.width, metrics.headerHeight)
      }

      context.fillStyle = COLORS.headerText
      context.fillText(columnHeader(column), rect.x + 4, metrics.headerHeight / 2)
    }

    for (const row of rowsOnScreen) {
      const rect = rectangleOfCell(metrics, view, { row, column: 0 }, frozen)
      const whole = coversRow(selection, row, columns)
      const touched =
        whole ||
        selection.ranges.some((range) => {
          const bounds = boundsOf(range)
          return row >= bounds.top && row <= bounds.bottom
        })

      if (touched) {
        context.fillStyle = whole ? COLORS.headerSelected : COLORS.headerTouched
        context.fillRect(0, rect.y, metrics.headerWidth, rect.height)
      }

      context.fillStyle = COLORS.headerText
      context.fillText(rowHeader(row), 4, rect.y + rect.height / 2)
    }

    // The line where the frozen strip ends, which is what tells somebody the
    // rows above it are not simply the rows they scrolled to.
    if (frozen !== null) {
      const size = frozenSize(metrics, frozen)
      context.strokeStyle = COLORS.headerText
      context.lineWidth = 1
      context.beginPath()

      if (frozen.rows > 0) {
        context.moveTo(0, metrics.headerHeight + size.height)
        context.lineTo(width, metrics.headerHeight + size.height)
      }
      if (frozen.columns > 0) {
        context.moveTo(metrics.headerWidth + size.width, 0)
        context.lineTo(metrics.headerWidth + size.width, height)
      }

      context.stroke()
    }

    // The active cell's outline last, so nothing draws over it.
    context.strokeStyle = COLORS.selection
    context.lineWidth = 2
    context.strokeRect(activeRect.x, activeRect.y, activeRect.width, activeRect.height)
  }, [
    columnHeader,
    columns,
    frozen,
    height,
    mergeAt,
    metrics,
    rowHeader,
    rows,
    scroll.x,
    scroll.y,
    selected,
    selectedCells,
    selection,
    styleAt,
    valueAt,
    width,
    zoom,
  ])

  /**
   * Follows a selection the caller moved.
   *
   * Typing `Z900` into a name box has to scroll there, and the grid never saw
   * the gesture that asked for it — only the answer.
   */
  useEffect(() => {
    if (given === undefined) return

    setScroll((was) => {
      const to = scrollToCell(
        metrics,
        { ...was, scrollX: was.x, scrollY: was.y, width, height },
        given.active,
      )
      return to.scrollX === was.x && to.scrollY === was.y ? was : { x: to.scrollX, y: to.scrollY }
    })
    // Only when the cell moves: a selection extended by dragging has already
    // scrolled itself, and re-running on every range would fight the drag.
  }, [given?.active.row, given?.active.column, height, metrics, width])

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

  /** Announced and kept, so a caller that controls the selection still hears. */
  const choose = useCallback(
    (next: GridSelection, showing: CellAddress = next.active) => {
      setOwn(next)
      onSelectionChange?.(next)

      const to = scrollToCell(metrics, { ...viewport }, showing)
      setScroll({ x: to.scrollX, y: to.scrollY })
    },
    // The viewport is rebuilt on each render from scroll and size, which are
    // already dependencies of what this reads.
    [metrics, onSelectionChange, viewport],
  )

  const inside = useCallback(
    (cell: CellAddress): CellAddress => ({
      row: Math.max(0, Math.min(cell.row, rows - 1)),
      column: Math.max(0, Math.min(cell.column, columns - 1)),
    }),
    [columns, rows],
  )

  /** Moving the cursor, which throws away whatever was selected. */
  const move = useCallback(
    (cell: CellAddress) => {
      choose(singleCell(inside(cell)))
    },
    [choose, inside],
  )

  /**
   * Where `Enter` and `Tab` go.
   *
   * Inside the selection when there is one to be inside, which is what stops
   * the cursor wandering off the end of a block somebody selected in order to
   * fill it. With one cell selected there is nothing to stay inside, and the
   * key moves the cursor as it always did.
   */
  const advance = useCallback(
    (order: Order, backward: boolean) => {
      if (selectedCells > 1) {
        const to = nextInSelection(selection, selected, order, backward)
        choose({ ...selection, active: to }, to)
        return
      }

      const step = backward ? -1 : 1
      move(
        order === 'down'
          ? { row: selected.row + step, column: selected.column }
          : { row: selected.row, column: selected.column + step },
      )
    },
    [choose, move, selected, selectedCells, selection],
  )

  /** Whether a cell holds anything, which is what `Mod` and an arrow follow. */
  const filled = useCallback(
    (cell: CellAddress) => {
      const text = valueAt(cell)
      return text !== null && text !== ''
    },
    [valueAt],
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

  const ARROWS: Record<string, Direction> = {
    ArrowDown: 'down',
    ArrowUp: 'up',
    ArrowRight: 'right',
    ArrowLeft: 'left',
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (editing !== null) return

    const counts = { rows, columns }
    const jumping = event.metaKey || event.ctrlKey

    // Everything. Excel's own `Mod+A` grows from the block outwards first;
    // that needs a notion of "the block", which arrives with the fill handle
    // and the sorting that depend on the same idea.
    if (jumping && event.key.toLowerCase() === 'a') {
      event.preventDefault()
      choose(everything(rows, columns), selected)
      return
    }

    const direction = ARROWS[event.key]
    if (direction !== undefined) {
      event.preventDefault()

      // `Shift` moves the far corner of the range and leaves the near one —
      // and the active cell — where they are; without it the whole selection
      // collapses to wherever the cursor landed.
      const from = event.shiftKey ? lastRange(selection).focus : selected
      const to = jumping
        ? edgeFrom(from, direction, counts, filled)
        : stepFrom(from, direction, counts)

      if (event.shiftKey) choose(extendedTo(selection, to), to)
      else move(to)
      return
    }

    if (event.key === 'Enter' || event.key === 'Tab') {
      event.preventDefault()
      advance(event.key === 'Enter' ? 'down' : 'across', event.shiftKey)
      return
    }

    if (event.key === 'F2' && canEdit(selected)) {
      event.preventDefault()
      setEditing({ cell: selected, text: valueAt(selected) ?? '' })
      return
    }

    // Delete empties what is selected, as it does in every spreadsheet. Handed
    // over as empty text rather than as a value of its own: what emptying a
    // cell means is the caller's to decide, and for a chart it is a gap rather
    // than a nought.
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (onDelete !== undefined) {
        event.preventDefault()
        onDelete(selection)
        return
      }

      if (canEdit(selected)) {
        event.preventDefault()
        if (valueAt(selected) !== null && valueAt(selected) !== '') onChange?.(selected, '')
        return
      }
    }

    // Typing into a selected cell replaces what is in it, as every spreadsheet
    // does: the first keystroke is the first character, not a lost one.
    if (event.key.length === 1 && !event.metaKey && !event.ctrlKey && canEdit(selected)) {
      event.preventDefault()
      setEditing({ cell: selected, text: event.key })
    }
  }

  const editor = editing === null ? null : rectangleOfCell(metrics, viewport, editing.cell, frozen)

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

          const point = { x: event.clientX - box.left, y: event.clientY - box.top }
          const counts = { rows, columns }
          const adding = event.metaKey || event.ctrlKey

          const header = headerAtPoint(metrics, viewport, point, counts, frozen)
          if (header !== null) {
            if (header.kind === 'corner') {
              choose(everything(rows, columns), selected)
              return
            }

            const range =
              header.kind === 'column'
                ? wholeColumns(header.index, header.index, rows)
                : wholeRows(header.index, header.index, columns)

            // Dragging across the headers picks a run of them, the same
            // gesture as dragging across cells.
            dragging.current = true
            holdPointer(event.currentTarget, event.pointerId, true)

            if (event.shiftKey) choose(extendedTo(selection, range.focus), range.focus)
            else if (adding) choose(withRange(selection, range), range.anchor)
            else choose({ ranges: [range], active: range.anchor }, range.anchor)
            return
          }

          const cell = cellAtPoint(metrics, viewport, point, counts, frozen)
          if (cell === null) return

          dragging.current = true
          holdPointer(event.currentTarget, event.pointerId, true)

          if (event.shiftKey) choose(extendedTo(selection, cell), cell)
          else if (adding) choose(withRange(selection, { anchor: cell, focus: cell }), cell)
          else move(cell)
        }}
        onPointerUp={(event) => {
          dragging.current = false
          holdPointer(event.currentTarget, event.pointerId, false)
        }}
        onDoubleClick={() => {
          if (canEdit(selected)) setEditing({ cell: selected, text: valueAt(selected) ?? '' })
        }}
        onPointerMove={(event) => {
          const box = event.currentTarget.parentElement?.getBoundingClientRect()
          if (box === undefined) return

          const point = { x: event.clientX - box.left, y: event.clientY - box.top }
          const cell = cellAtPoint(metrics, viewport, point, { rows, columns }, frozen)

          if (dragging.current) {
            // Dragging past the edge of the cells keeps hold of the last one
            // it was over, rather than letting go of the range.
            const header = headerAtPoint(metrics, viewport, point, { rows, columns }, frozen)
            const to =
              cell ??
              (header?.kind === 'column'
                ? { row: rows - 1, column: header.index }
                : header?.kind === 'row'
                  ? { row: header.index, column: columns - 1 }
                  : null)

            if (to !== null) choose(extendedTo(selection, to), to)
            return
          }

          onHoverCell?.(cell)
        }}
        onPointerLeave={() => {
          if (!dragging.current) onHoverCell?.(null)
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

        {overlay !== undefined && (
          <div
            // Pinned like the canvas and over it, and deaf to the pointer: a
            // chart sitting on a sheet must not stop a click reaching the cell
            // it is drawn across.
            style={{
              position: 'sticky',
              top: 0,
              left: 0,
              width,
              height,
              marginTop: -height,
              overflow: 'hidden',
              pointerEvents: 'none',
            }}
          >
            {overlay({ scrollX: scroll.x, scrollY: scroll.y, metrics })}
          </div>
        )}
      </div>

      {editing !== null && editor !== null && (
        // A textarea rather than an input, for one key: `Alt+Enter` puts a
        // line break inside a cell, and a single-line field has nowhere to put
        // one. It is made to look like an input — no resize handle, no
        // scrollbars, no wrapping it did not ask for.
        <textarea
          autoFocus
          rows={1}
          wrap="off"
          aria-label={`${columnHeader(editing.cell.column)}${String(editing.cell.row + 1)}`}
          value={editing.text}
          onFocus={(event) => {
            // At the end, not the start. A textarea puts the caret at nought
            // where an input puts it after the value, which would make the
            // second character of anything typed land in front of the first.
            const end = event.currentTarget.value.length
            event.currentTarget.setSelectionRange(end, end)
          }}
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
            if (event.key === 'Escape') {
              event.preventDefault()
              stopEditing()
              return
            }

            if (event.key === 'Enter') {
              event.preventDefault()

              // A line break inside the cell rather than the end of the edit.
              if (event.altKey) {
                const field = event.currentTarget
                const at = field.selectionStart
                const to = field.selectionEnd
                setEditing({
                  cell: editing.cell,
                  text: `${editing.text.slice(0, at)}\n${editing.text.slice(to)}`,
                })
                return
              }

              // The same value into everything selected, which is one thing
              // done and has to be one thing the caller can take back.
              if ((event.metaKey || event.ctrlKey) && onFill !== undefined) {
                closing.current = true
                setEditing(null)
                surface.current?.focus()
                onFill(selection, editing.text)
                return
              }

              commit(editing.text, editing.cell)
              advance('down', event.shiftKey)
              return
            }

            if (event.key === 'Tab') {
              event.preventDefault()
              commit(editing.text, editing.cell)
              advance('across', event.shiftKey)
            }
          }}
          style={{
            position: 'absolute',
            left: editor.x,
            top: editor.y,
            width: widthOfColumn(metrics, editing.cell.column),
            height: heightOfRow(metrics, editing.cell.row),
            font: resized('12px -apple-system, system-ui, sans-serif', zoom),
            border: `2px solid ${COLORS.selection}`,
            padding: '0 2px',
            outline: 'none',
            background: COLORS.background,
            color: COLORS.text,
            resize: 'none',
            overflow: 'hidden',
            whiteSpace: 'pre',
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
        }${selectedCells > 1 ? `, ${String(selectedCells)} cells selected` : ''}`}
      </span>
    </div>
  )
}

/** Keeps the canvas in step with a value that changed outside a render. */
export function useRedrawOn(value: unknown, redraw: () => void): void {
  useEffect(redraw, [redraw, value])
}
