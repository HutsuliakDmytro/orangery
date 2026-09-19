import { useMemo } from 'react'
import { ChartView, readChart } from '@orangery/charts'
import { dataUrlFrom } from '@orangery/ooxml-drawingml'
import type { Color, ColorContext } from '@orangery/ooxml-drawingml'
import { getPartText } from '@orangery/ooxml-core'
import { EMU_PER_POINT } from '@orangery/ooxml-spreadsheet'
import type { AnchorPoint, DrawingAnchor } from '@orangery/ooxml-spreadsheet'
import { offsetOfColumn, offsetOfRow } from '@orangery/grid'
import type { GridMetrics, Rectangle } from '@orangery/grid'
import type { AnchoredDrawing, OpenSheet, OpenWorkbook } from '../document/workbook'

/**
 * What sits on a sheet rather than in it.
 *
 * Drawn as elements over the canvas rather than painted into it: a chart is an
 * SVG the shared renderer already produces, and a picture is an `<img>` the
 * platform decodes, scales and caches better than anything here would. The
 * canvas is for the million cells, which is the part a browser cannot do.
 *
 * Read-only, and deaf to the pointer — a chart lying across a column must not
 * stop a click reaching the cell under it. Selecting and moving them is
 * editing, and comes with the rest of it (`PLAN.md`, phase 4).
 */

export interface SheetDrawingsProps {
  open: OpenWorkbook
  sheet: OpenSheet
  /** Already zoomed, as the grid hands them over. */
  metrics: GridMetrics
  scrollX: number
  scrollY: number
  zoom: number
}

export function SheetDrawings({
  open,
  sheet,
  metrics,
  scrollX,
  scrollY,
  zoom,
}: SheetDrawingsProps) {
  /**
   * What the chart's colours mean.
   *
   * A chart names them symbolically — `accent1`, not a hex — so the workbook's
   * theme is what says what they are. The same rule the other two apps follow,
   * and the reason a chart recolours when the theme does.
   */
  const context = useMemo<ColorContext>(
    () => ({
      scheme: new Map<string, Color>(
        [...open.palette.scheme].map(([slot, hex]) => [
          slot,
          { source: { kind: 'srgb', hex: `#${hex}` }, transforms: [] },
        ]),
      ),
      map: new Map(),
    }),
    [open.palette.scheme],
  )

  return (
    <>
      {sheet.drawings.map((anchored, index) => {
        const box = rectangleOf(anchored.drawing.anchor, metrics, zoom)
        if (box === null) return null

        const style = {
          position: 'absolute' as const,
          left: metrics.headerWidth + box.x - scrollX,
          top: metrics.headerHeight + box.y - scrollY,
          width: box.width,
          height: box.height,
        }

        return (
          <div
            // A drawing has no id of its own that survives a reorder; its place
            // in the part is what identifies it, and that is what this list is.
            key={`${String(index)}:${anchored.drawing.name}`}
            data-drawing={anchored.drawing.content.kind}
            aria-label={anchored.drawing.name}
            style={style}
          >
            <Drawn
              open={open}
              anchored={anchored}
              width={box.width}
              height={box.height}
              context={context}
            />
          </div>
        )
      })}
    </>
  )
}

/** One drawing's content, or nothing where it is a kind nothing here draws. */
function Drawn({
  open,
  anchored,
  width,
  height,
  context,
}: {
  open: OpenWorkbook
  anchored: AnchoredDrawing
  width: number
  height: number
  context: ColorContext
}) {
  const content = anchored.drawing.content
  const path = anchored.path

  const chart = useMemo(() => {
    if (content.kind !== 'chart' || path === null) return null

    const xml = getPartText(open.pkg, path)
    return xml === undefined ? null : readChart(xml)
  }, [content.kind, open.pkg, path])

  const picture = useMemo(() => {
    if (content.kind !== 'picture' || path === null) return null

    const bytes = open.pkg.parts.get(path)?.bytes
    return bytes === undefined ? null : dataUrlFrom(bytes, path)
  }, [content.kind, open.pkg, path])

  if (chart !== null) {
    return (
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${String(width)} ${String(height)}`}
        role="presentation"
      >
        <ChartView
          chart={chart}
          x={0}
          y={0}
          width={width}
          height={height}
          theme={undefined}
          context={context}
        />
      </svg>
    )
  }

  if (picture !== null) {
    return (
      <img
        src={picture}
        alt={anchored.drawing.name}
        style={{ width: '100%', height: '100%', objectFit: 'fill' }}
      />
    )
  }

  // A shape, a piece of SmartArt, an image in a format no browser decodes.
  // Nothing is drawn and nothing is lost: the part is written back whole, and
  // a placeholder over the cells would be a worse lie than a gap.
  return null
}

/**
 * Where a drawing sits, in the same units the grid measures cells in.
 *
 * An anchor is a cell and a way into it, so the arithmetic is the grid's own
 * offsets plus an offset in EMU. The offsets are scaled by the zoom because
 * the grid's are: a drawing that kept its inset while the columns grew would
 * creep out of place across the sheet.
 */
function rectangleOf(anchor: DrawingAnchor, metrics: GridMetrics, zoom: number): Rectangle | null {
  const across = (point: AnchorPoint) =>
    offsetOfColumn(metrics, point.column) + (point.columnOffset / EMU_PER_POINT) * zoom
  const down = (point: AnchorPoint) =>
    offsetOfRow(metrics, point.row) + (point.rowOffset / EMU_PER_POINT) * zoom

  if (anchor.kind === 'two') {
    const x = across(anchor.from)
    const y = down(anchor.from)

    // A drawing whose corners are the same cell has no size; Excel writes that
    // for one collapsed into a hidden column, and it is drawn as nothing.
    const width = across(anchor.to) - x
    const height = down(anchor.to) - y
    return width <= 0 || height <= 0 ? null : { x, y, width, height }
  }

  if (anchor.kind === 'one') {
    return {
      x: across(anchor.from),
      y: down(anchor.from),
      width: (anchor.width / EMU_PER_POINT) * zoom,
      height: (anchor.height / EMU_PER_POINT) * zoom,
    }
  }

  return {
    x: (anchor.x / EMU_PER_POINT) * zoom,
    y: (anchor.y / EMU_PER_POINT) * zoom,
    width: (anchor.width / EMU_PER_POINT) * zoom,
    height: (anchor.height / EMU_PER_POINT) * zoom,
  }
}
