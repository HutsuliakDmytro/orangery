import { allSeries, chartKind, resolveColor } from '@orangery/ooxml-drawingml'
import type {
  Chart,
  ChartPlot,
  ChartSeries,
  ColorContext,
  DataLabels,
  Theme,
} from '@orangery/ooxml-drawingml'

/**
 * A chart, drawn from the values cached in its part.
 *
 * Five families: bar and column, line, pie and doughnut, area, scatter.
 * Anything else is framed and labelled rather than approximated — a radar chart
 * drawn as bars would be a lie, while an empty frame is at least honest about
 * the shape of the slide.
 *
 * A chart can hold more than one group. Columns with a line over them is two,
 * and the second is usually measured against an axis of its own: a revenue in
 * millions beside a margin in percent, where one scale for both would draw the
 * margin as a flat line along the bottom.
 *
 * Read-only throughout. The chart's part is written back whole, so nothing here
 * can reach the file.
 */

const AXIS = '#9A9A9A'
const GRID = '#E4E4E4'
const LABEL = '#4A4A4A'

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

interface Range {
  min: number
  max: number
}

const rangeOfValues = (values: readonly (number | null)[]): Range => {
  const numbers = values.filter((value): value is number => value !== null)
  if (numbers.length === 0) return { min: 0, max: 1 }

  const max = Math.max(...numbers, 0)
  const min = Math.min(...numbers, 0)
  // A flat series would divide by zero; give it something to stand on.
  return max === min ? { min, max: min + 1 } : { min, max }
}

const rangeOf = (series: readonly ChartSeries[]): Range =>
  rangeOfValues(series.flatMap((one) => one.values))

/** How far along a scatter's bottom the points reach. */
const rangeAcross = (series: readonly ChartSeries[]): Range =>
  rangeOfValues(series.flatMap((one) => one.xValues ?? []))

/** A number as a label: short enough to read on a chart the size of a thumbnail. */
const shown = (value: number): string => String(Math.round(value * 10) / 10)

function Axes({
  plot,
  range,
  side = 'left',
  grid = true,
}: {
  plot: Plot
  range: Range
  /** The right-hand axis belongs to the second group, when there is one. */
  side?: 'left' | 'right'
  /** Only one axis draws the lines across; two sets would make a mesh. */
  grid?: boolean
}) {
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
            {grid && (
              <line
                x1={padding.left}
                y1={y}
                x2={plot.width - padding.right}
                y2={y}
                stroke={GRID}
                strokeWidth={1}
              />
            )}
            <text
              x={side === 'left' ? padding.left - 4 : plot.width - padding.right + 4}
              y={y + 3}
              textAnchor={side === 'left' ? 'end' : 'start'}
              fontSize={9}
              fill={AXIS}
            >
              {shown(value)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/** What a point says about itself, when the chart asks it to say anything. */
function PointLabel({
  labels,
  value,
  category,
  share,
  x,
  y,
}: {
  labels: DataLabels
  value: number
  category: string | undefined
  /** The point's part of the whole, for a pie that shows percentages. */
  share?: number
  x: number
  y: number
}) {
  const parts = [
    labels.categories && category !== undefined && category !== '' ? category : null,
    labels.percentages && share !== undefined ? `${String(Math.round(share * 100))}%` : null,
    labels.values ? shown(value) : null,
  ].filter((part): part is string => part !== null)

  if (parts.length === 0) return null

  return (
    <text x={x} y={y} textAnchor="middle" fontSize={8} fill={LABEL}>
      {parts.join(' ')}
    </text>
  )
}

function Bars({
  group,
  categories,
  plot,
  range,
  colors,
}: {
  group: ChartPlot
  categories: readonly string[]
  plot: Plot
  range: Range
  colors: readonly string[]
}) {
  const { padding } = plot
  const width = plot.width - padding.left - padding.right
  const height = plot.height - padding.top - padding.bottom
  const groups = categories.length || 1
  const groupWidth = width / groups
  const barWidth = (groupWidth * 0.7) / Math.max(group.series.length, 1)
  const zero = padding.top + height * (range.max / (range.max - range.min))

  return (
    <g>
      {group.series.map((series, seriesIndex) =>
        series.values.map((value, index) => {
          if (value === null) return null
          const top = padding.top + height * ((range.max - value) / (range.max - range.min))
          const x = padding.left + groupWidth * index + groupWidth * 0.15 + barWidth * seriesIndex

          return (
            <g key={`${String(seriesIndex)}-${String(index)}`}>
              <rect
                x={x}
                y={Math.min(top, zero)}
                width={barWidth}
                height={Math.abs(zero - top)}
                fill={colors[seriesIndex] ?? AXIS}
              />
              <PointLabel
                labels={group.labels}
                value={value}
                category={categories[index]}
                x={x + barWidth / 2}
                y={Math.min(top, zero) - 2}
              />
            </g>
          )
        }),
      )}
    </g>
  )
}

function Lines({
  group,
  categories,
  plot,
  range,
  colors,
  filled,
}: {
  group: ChartPlot
  categories: readonly string[]
  plot: Plot
  range: Range
  colors: readonly string[]
  filled: boolean
}) {
  const { padding } = plot
  const width = plot.width - padding.left - padding.right
  const height = plot.height - padding.top - padding.bottom
  const step = width / Math.max(categories.length - 1, 1)

  return (
    <g>
      {group.series.map((series, seriesIndex) => {
        const points = series.values.flatMap((value, index) =>
          value === null
            ? []
            : [
                {
                  x: padding.left + step * index,
                  y: padding.top + height * ((range.max - value) / (range.max - range.min)),
                  value,
                  index,
                },
              ],
        )
        if (points.length === 0) return null

        const path = points
          .map((point, index) => `${index === 0 ? 'M' : 'L'}${String(point.x)},${String(point.y)}`)
          .join(' ')

        return (
          <g key={seriesIndex}>
            {filled && (
              <path
                d={`${path} L${String(points[points.length - 1]?.x ?? 0)},${String(
                  padding.top + height,
                )} L${String(points[0]?.x ?? 0)},${String(padding.top + height)} Z`}
                fill={colors[seriesIndex] ?? AXIS}
                fillOpacity={0.3}
              />
            )}
            <path d={path} fill="none" stroke={colors[seriesIndex] ?? AXIS} strokeWidth={2} />
            {points.map((point) => (
              <PointLabel
                key={point.index}
                labels={group.labels}
                value={point.value}
                category={categories[point.index]}
                x={point.x}
                y={point.y - 4}
              />
            ))}
          </g>
        )
      })}
    </g>
  )
}

/**
 * A scatter, where both axes are numbers.
 *
 * The difference from a line chart is the bottom: points sit where their x says
 * rather than at even steps, which is the whole reason somebody chose this
 * chart. Whether they are joined is `c:scatterStyle`; a plain `marker` means
 * the points and nothing between them.
 */
function Scatter({
  group,
  plot,
  range,
  across,
  colors,
}: {
  group: ChartPlot
  plot: Plot
  range: Range
  across: Range
  colors: readonly string[]
}) {
  const { padding } = plot
  const width = plot.width - padding.left - padding.right
  const height = plot.height - padding.top - padding.bottom
  const joined = group.scatterStyle !== 'marker' && group.scatterStyle !== 'none'

  return (
    <g>
      {group.series.map((series, seriesIndex) => {
        const points = series.values.flatMap((value, index) => {
          const at = series.xValues?.[index] ?? null
          if (value === null || at === null) return []

          return [
            {
              x: padding.left + width * ((at - across.min) / (across.max - across.min)),
              y: padding.top + height * ((range.max - value) / (range.max - range.min)),
              value,
              index,
            },
          ]
        })
        if (points.length === 0) return null

        const colour = colors[seriesIndex] ?? AXIS

        return (
          <g key={seriesIndex}>
            {joined && (
              <path
                d={points
                  .map(
                    (point, index) =>
                      `${index === 0 ? 'M' : 'L'}${String(point.x)},${String(point.y)}`,
                  )
                  .join(' ')}
                fill="none"
                stroke={colour}
                strokeWidth={2}
              />
            )}
            {points.map((point) => (
              <g key={point.index}>
                <circle cx={point.x} cy={point.y} r={3} fill={colour} />
                <PointLabel
                  labels={group.labels}
                  value={point.value}
                  category={undefined}
                  x={point.x}
                  y={point.y - 5}
                />
              </g>
            ))}
          </g>
        )
      })}
    </g>
  )
}

/** The numbers along the bottom of a scatter, which a category axis does not have. */
function AcrossAxis({ plot, across }: { plot: Plot; across: Range }) {
  const { padding } = plot
  const width = plot.width - padding.left - padding.right
  const ticks = 4

  return (
    <g>
      {Array.from({ length: ticks + 1 }, (_, index) => {
        const x = padding.left + (width * index) / ticks
        const value = across.min + ((across.max - across.min) * index) / ticks

        return (
          <text
            key={index}
            x={x}
            y={plot.height - padding.bottom + 10}
            textAnchor="middle"
            fontSize={9}
            fill={AXIS}
          >
            {shown(value)}
          </text>
        )
      })}
    </g>
  )
}

function Pie({
  group,
  categories,
  plot,
  colors,
  doughnut,
}: {
  group: ChartPlot
  categories: readonly string[]
  plot: Plot
  colors: readonly string[]
  doughnut: boolean
}) {
  const values = (group.series[0]?.values ?? []).map((value) => value ?? 0)
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
      {values.map((value, index) => {
        const from = starts[index] ?? 0
        const to = starts[index + 1] ?? from
        const large = to - from > Math.PI ? 1 : 0
        const middle = (from + to) / 2

        const path = doughnut
          ? `M${point(radius, from)} A${String(radius)},${String(radius)} 0 ${String(large)} 1 ${point(radius, to)} ` +
            `L${point(inner, to)} A${String(inner)},${String(inner)} 0 ${String(large)} 0 ${point(inner, from)} Z`
          : `M${String(cx)},${String(cy)} L${point(radius, from)} ` +
            `A${String(radius)},${String(radius)} 0 ${String(large)} 1 ${point(radius, to)} Z`

        return (
          <g key={index}>
            <path d={path} fill={colors[index % colors.length] ?? AXIS} />
            <PointLabel
              labels={group.labels}
              value={value}
              category={categories[index]}
              share={Math.abs(value) / total}
              x={cx + Math.cos(middle) * radius * 0.7}
              y={cy + Math.sin(middle) * radius * 0.7 + 3}
            />
          </g>
        )
      })}
    </g>
  )
}

function Legend({ chart, plot, colors }: { chart: Chart; plot: Plot; colors: readonly string[] }) {
  if (chart.legend === null) return null

  const kind = chartKind(chart)
  const names =
    kind === 'pie' || kind === 'doughnut'
      ? chart.categories
      : allSeries(chart).map((series, index) => series.name ?? `Series ${String(index + 1)}`)

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

/** One group of the plot area, drawn against the scale it belongs to. */
function Group({
  group,
  chart,
  plot,
  range,
  across,
  colors,
}: {
  group: ChartPlot
  chart: Chart
  plot: Plot
  range: Range
  across: Range
  colors: readonly string[]
}) {
  switch (group.kind) {
    case 'bar':
      return (
        <Bars
          group={group}
          categories={chart.categories}
          plot={plot}
          range={range}
          colors={colors}
        />
      )
    case 'line':
    case 'area':
      return (
        <Lines
          group={group}
          categories={chart.categories}
          plot={plot}
          range={range}
          colors={colors}
          filled={group.kind === 'area'}
        />
      )
    case 'scatter':
      return <Scatter group={group} plot={plot} range={range} across={across} colors={colors} />
    case 'pie':
    case 'doughnut':
      return (
        <Pie
          group={group}
          categories={chart.categories}
          plot={plot}
          colors={colors}
          doughnut={group.kind === 'doughnut'}
        />
      )
    default:
      return null
  }
}

/** Whether a kind is drawn against a pair of axes rather than in a circle. */
const onAxes = (plot: ChartPlot): boolean =>
  plot.kind !== 'pie' && plot.kind !== 'doughnut' && plot.kind !== 'unknown'

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
  const secondary = chart.plots.find((one) => one.secondary)

  // Drawn in its own small coordinate space and scaled to the frame: chart
  // geometry in EMU would make every tick label a thousandth of a pixel.
  const plot: Plot = {
    width: 320,
    height: 200,
    padding: {
      left: 34,
      // Room on the right only when something is measured there.
      right: secondary === undefined ? 8 : 34,
      top: 10,
      bottom: chart.legend === null ? 18 : 30,
    },
  }

  const series = allSeries(chart)
  const colors = seriesColors(Math.max(series.length, chart.categories.length, 1), theme, context)

  const primaryPlots = chart.plots.filter((one) => !one.secondary)
  const scales = {
    primary: rangeOf(primaryPlots.flatMap((one) => one.series)),
    secondary: secondary === undefined ? null : rangeOf(secondary.series),
  }
  const across = rangeAcross(series)

  const scatter = chart.plots.some((one) => one.kind === 'scatter')
  const drawn = chart.plots.filter(onAxes)

  // How many series each group has, so the second group's colours carry on
  // from where the first group's stopped rather than repeating them.
  const offsets = chart.plots.reduce<number[]>(
    (counts, one) => [...counts, (counts[counts.length - 1] ?? 0) + one.series.length],
    [0],
  )

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

      {drawn.length > 0 && <Axes plot={plot} range={scales.primary} />}
      {scales.secondary !== null && (
        <Axes plot={plot} range={scales.secondary} side="right" grid={false} />
      )}
      {scatter && <AcrossAxis plot={plot} across={across} />}

      {chart.plots.map((group, index) => (
        <Group
          key={index}
          group={group}
          chart={chart}
          plot={plot}
          range={group.secondary && scales.secondary !== null ? scales.secondary : scales.primary}
          across={across}
          colors={colors.slice(offsets[index] ?? 0)}
        />
      ))}

      {chart.plots.length === 0 && (
        <text x={plot.width / 2} y={plot.height / 2} textAnchor="middle" fontSize={11} fill={AXIS}>
          Chart
        </text>
      )}

      <Legend chart={chart} plot={plot} colors={colors} />
    </svg>
  )
}
