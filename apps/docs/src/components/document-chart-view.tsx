import { NodeViewWrapper } from '@tiptap/react'
import type { NodeViewProps } from '@tiptap/react'
import { useMemo } from 'react'
import { ChartView, readChart } from '@orangery/charts'
import type { Color, ColorContext } from '@orangery/ooxml-drawingml'

/**
 * A chart, drawn where the document puts it.
 *
 * The same renderer the deck app uses, so a chart copied from a presentation
 * into a document looks like itself. Read-only: the part is written back whole,
 * and there is no path from here to the file.
 *
 * A chart whose part could not be read still takes up its space rather than
 * collapsing the line — the document reflows around a frame of the size the
 * file says is there.
 */
export function ChartFrame({
  width,
  height,
  xml,
  themeColors,
}: {
  width: number
  height: number
  /** The chart part, read when the document was opened; null when it was not. */
  xml: string | null
  /** The document theme's slots as hexes, which is what colours the chart. */
  themeColors: readonly (readonly [string, string])[]
}) {
  const chart = useMemo(() => (xml === null ? null : readChart(xml)), [xml])

  // A chart states its colours symbolically — `accent1`, not a hex — so the
  // theme is what says what they mean. Resolved here and never on the way back
  // to the file.
  const context = useMemo<ColorContext>(
    () => ({
      scheme: new Map<string, Color>(
        themeColors.map(([slot, hex]) => [slot, { source: { kind: 'srgb', hex }, transforms: [] }]),
      ),
      map: new Map(),
    }),
    [themeColors],
  )

  return (
    <span
      data-chart=""
      style={{
        display: 'inline-block',
        width: `${String(width)}pt`,
        height: `${String(height)}pt`,
        verticalAlign: 'bottom',
      }}
    >
      {chart === null ? null : (
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
      )}
    </span>
  )
}

/** The node view around it, which is where the attributes come from. */
export function DocumentChartView({ node }: NodeViewProps) {
  const themeColors = Array.isArray(node.attrs['themeColors'])
    ? (node.attrs['themeColors'] as [string, string][])
    : []

  return (
    <NodeViewWrapper as="span">
      <ChartFrame
        width={typeof node.attrs['width'] === 'number' ? node.attrs['width'] : 0}
        height={typeof node.attrs['height'] === 'number' ? node.attrs['height'] : 0}
        xml={typeof node.attrs['chart'] === 'string' ? node.attrs['chart'] : null}
        themeColors={themeColors}
      />
    </NodeViewWrapper>
  )
}
