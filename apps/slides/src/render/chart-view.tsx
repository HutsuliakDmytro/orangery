import { resolveColor } from '@orangery/ooxml-drawingml'
import type { Chart, ChartSeries, ColorContext, Theme } from '@orangery/ooxml-drawingml'

/**
 * A chart, drawn from the values cached in its part.
 *
 * Four families: bar and column, line, pie and doughnut, area. Anything else is
 * framed and labelled rather than approximated — a radar chart drawn as bars
 * would be a lie, while an empty frame is at least honest about the shape of
 * the slide.
 *
 * Read-only throughout. The chart's part is written back whole, so nothing here
 * can reach the file.
 */

const AXIS = '#9A9A9A'
const GRID = '#E4E4E4'

/** Series colours come from the theme's accents, as PowerPoint's own do. */
function seriesColors(count: number, theme: Theme | undefined, context: ColorContext): string[] {
  const fallback = ['#4F81BD', '#C0504D', '#9BBB59', '#8064A2', '#4BACC6', '#F79646']

  return Array.from({ length: count }, (_, index) => {
    const slot = `accent${String((index % 6) + 1)}`
    const defined = theme?.colors.get(slot)
    const resolved = defined === undefined ? null : resolveColor(defined, context)
    return resolved?.hex ?? fallback[index % 6] ?? '#4F81BD'
  })
}

interface Plot {
  width: number
  height: number
  /** Room for the axis labels and the legend. */
  padding: { left: number; right: number; top: number; bottom: number }
}

const rangeOf = (series: readonly ChartSeries[]): { min: number; max: number } => {
  const values = series.flatMap((one) =>
    one.values.filter((value): value is number => value !== null),
  )
  if (values.length === 0) return { min: 0, max: 1 }

  const max = Math.max(...values, 0)
  const min = Math.min(...values, 0)
  // A flat series would divide by zero; give it something to stand on.
  return max === min ? { min, max: min + 1 } : { min, max }
}

function Axes({ plot, range }: { plot: Plot; range: { min: number; max: number } }) {
  const { padding } = plot
  const inner = plot.height - padding.top - padding.bottom
  const ticks = 4

  return (
    <g>
      {Array.from({ length: ticks + 1 }, (_, index) => {
        const y = padding.top + (inner * index) / ticks
        const value = range.max - ((range.max - range.min) * index) / ticks

        return (
          <g key={index}>
            <line
              x1={padding.left}
              y1={y}
              x2={plot.width - padding.right}
              y2={y}
              stroke={GRID}
              strokeWidth={1}
            />
            <text x={padding.left - 4} y={y + 3} textAnchor="end" fontSize={9} fill={AXIS}>
              {Math.round(value * 10) / 10}
            </text>
          </g>
        )
      })}
    </g>
  )
}

function Bars({ chart, plot, colors }: { chart: Chart; plot: Plot; colors: readonly string[] }) {
  const { padding } = plot
  const range = rangeOf(chart.series)
  const width = plot.width - padding.left - padding.right
  const height = plot.height - padding.top - padding.bottom
  const groups = chart.categories.length || 1
  const groupWidth = width / groups
  const barWidth = (groupWidth * 0.7) / Math.max(chart.series.length, 1)
  const zero = padding.top + height * (range.max / (range.max - range.min))

  return (
    <g>
      {chart.series.map((series, seriesIndex) =>
        series.values.map((value, index) => {
          if (value === null) return null
          const top = padding.top + height * ((range.max - value) / (range.max - range.min))
          const x = padding.left + groupWidth * index + groupWidth * 0.15 + barWidth * seriesIndex

          return (
            <rect
              key={`${String(seriesIndex)}-${String(index)}`}
              x={x}
              y={Math.min(top, zero)}
              width={barWidth}
              height={Math.abs(zero - top)}
              fill={colors[seriesIndex] ?? AXIS}
            />
          )
        }),
      )}
    </g>
  )
}

function Lines({
  chart,
  plot,
  colors,
  filled,
}: {
  chart: Chart
  plot: Plot
  colors: readonly string[]
  filled: boolean
}) {
  const { padding } = plot
  const range = rangeOf(chart.series)
  const width = plot.width - padding.left - padding.right
  const height = plot.height - padding.top - padding.bottom
  const step = width / Math.max(chart.categories.length - 1, 1)

  return (
    <g>
      {chart.series.map((series, seriesIndex) => {
        const points = series.values.flatMap((value, index) =>
          value === null
            ? []
            : [
                [
                  padding.left + step * index,
                  padding.top + height * ((range.max - value) / (range.max - range.min)),
                ] as const,
              ],
        )
        if (points.length === 0) return null

        const path = points
          .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${String(x)},${String(y)}`)
          .join(' ')

        return (
          <g key={seriesIndex}>
            {filled && (
              <path
                d={`${path} L${String(points[points.length - 1]?.[0] ?? 0)},${String(
                  padding.top + height,
                )} L${String(points[0]?.[0] ?? 0)},${String(padding.top + height)} Z`}
                fill={colors[seriesIndex] ?? AXIS}
                fillOpacity={0.3}
              />
            )}
            <path d={path} fill="none" stroke={colors[seriesIndex] ?? AXIS} strokeWidth={2} />
          </g>
        )
      })}
    </g>
  )
}

function Pie({
  chart,
  plot,
  colors,
  doughnut,
}: {
  chart: Chart
  plot: Plot
  colors: readonly string[]
  doughnut: boolean
}) {
  const values = (chart.series[0]?.values ?? []).map((value) => value ?? 0)
  const total = values.reduce((sum, value) => sum + Math.abs(value), 0)
  if (total === 0) return null

  const cx = plot.width / 2
  const cy = plot.height / 2
  const radius = Math.min(plot.width, plot.height) / 2 - 8
  const inner = doughnut ? radius * 0.55 : 0

  // Each slice starts where the ones before it ended. Computed rather than
  // accumulated in a variable: a component must not carry state between its
  // own statements, and a running total reads as if it might.
  const starts = values.reduce<number[]>(
    (angles, value) => [
      ...angles,
      (angles[angles.length - 1] ?? -Math.PI / 2) + (Math.abs(value) / total) * Math.PI * 2,
    ],
    [-Math.PI / 2],
  )

  const point = (r: number, a: number) =>
    `${String(cx + Math.cos(a) * r)},${String(cy + Math.sin(a) * r)}`

  return (
    <g>
      {values.map((_, index) => {
        const from = starts[index] ?? 0
        const to = starts[index + 1] ?? from
        const large = to - from > Math.PI ? 1 : 0

        const path = doughnut
          ? `M${point(radius, from)} A${String(radius)},${String(radius)} 0 ${String(large)} 1 ${point(radius, to)} ` +
            `L${point(inner, to)} A${String(inner)},${String(inner)} 0 ${String(large)} 0 ${point(inner, from)} Z`
          : `M${String(cx)},${String(cy)} L${point(radius, from)} ` +
            `A${String(radius)},${String(radius)} 0 ${String(large)} 1 ${point(radius, to)} Z`

        return <path key={index} d={path} fill={colors[index % colors.length] ?? AXIS} />
      })}
    </g>
  )
}

function Legend({ chart, plot, colors }: { chart: Chart; plot: Plot; colors: readonly string[] }) {
  if (chart.legend === null) return null

  const names =
    chart.kind === 'pie' || chart.kind === 'doughnut'
      ? chart.categories
      : chart.series.map((series, index) => series.name ?? `Series ${String(index + 1)}`)

  return (
    <g transform={`translate(0 ${String(plot.height - 12)})`}>
      {names.map((name, index) => (
        <g key={name} transform={`translate(${String(8 + index * 90)} 0)`}>
          <rect width={8} height={8} y={-8} fill={colors[index % colors.length] ?? AXIS} />
          <text x={12} fontSize={9} fill={AXIS}>
            {name}
          </text>
        </g>
      ))}
    </g>
  )
}

export function ChartView({
  chart,
  x,
  y,
  width,
  height,
  theme,
  context,
}: {
  chart: Chart
  x: number
  y: number
  width: number
  height: number
  theme: Theme | undefined
  context: ColorContext
}) {
  // Drawn in its own small coordinate space and scaled to the frame: chart
  // geometry in EMU would make every tick label a thousandth of a pixel.
  const plot: Plot = {
    width: 320,
    height: 200,
    padding: { left: 34, right: 8, top: 10, bottom: chart.legend === null ? 18 : 30 },
  }
  const colors = seriesColors(
    Math.max(chart.series.length, chart.categories.length, 1),
    theme,
    context,
  )

  const body = (() => {
    switch (chart.kind) {
      case 'bar':
        return (
          <>
            <Axes plot={plot} range={rangeOf(chart.series)} />
            <Bars chart={chart} plot={plot} colors={colors} />
          </>
        )
      case 'line':
      case 'area':
        return (
          <>
            <Axes plot={plot} range={rangeOf(chart.series)} />
            <Lines chart={chart} plot={plot} colors={colors} filled={chart.kind === 'area'} />
          </>
        )
      case 'pie':
      case 'doughnut':
        return (
          <Pie chart={chart} plot={plot} colors={colors} doughnut={chart.kind === 'doughnut'} />
        )
      default:
        return (
          <text
            x={plot.width / 2}
            y={plot.height / 2}
            textAnchor="middle"
            fontSize={11}
            fill={AXIS}
          >
            Chart
          </text>
        )
    }
  })()

  return (
    <svg
      x={x}
      y={y}
      width={width}
      height={height}
      viewBox={`0 0 ${String(plot.width)} ${String(plot.height)}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={chart.title ?? 'Chart'}
    >
      <rect width={plot.width} height={plot.height} fill="#FFFFFF" />
      {body}
      <Legend chart={chart} plot={plot} colors={colors} />
    </svg>
  )
}
