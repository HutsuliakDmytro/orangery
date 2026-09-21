import { resolveColor } from '@orangery/ooxml-drawingml'
import type { Color, ColorContext, Theme } from '@orangery/ooxml-drawingml'
import { allSeries, chartKind } from './chart'
import type { Chart, ChartAxis, ChartPlot, ChartSeries, DataLabels, ManualLayout } from './chart'

/**
 * A chart, drawn from the values cached in its part.
 *
 * Six families: bar and column, line, area, scatter, pie and doughnut, radar.
 * Anything else is framed and labelled rather than approximated — a waterfall
 * drawn as bars would put wrong numbers on the page, while an empty frame is at
 * least honest about what is missing.
 *
 * A chart can hold more than one group. Columns with a line over them is two,
 * and the second is usually measured against an axis of its own: a revenue in
 * millions beside a margin in percent, where one scale for both would draw the
 * margin as a flat line along the bottom.
 *
 * **Office's defaults are the target, not our taste.** Where a chart says
 * nothing about gaps, overlap or marker size, the numbers Office itself writes
 * are used, because that is what the same file looks like in the app it came
 * from.
 *
 * Read-only throughout. The chart's part is written back whole, so nothing here
 * can reach the file.
 */

const AXIS = '#9A9A9A'
const GRID = '#E4E4E4'
const LABEL = '#4A4A4A'

/** What Office writes when a chart is left alone, and so what to assume. */
const OFFICE = {
  /** The gap between clusters, as a percentage of one bar's width. */
  gapWidth: 150,
  /** Bars in a category sit apart in a clustered chart and on top of each other in a stacked one. */
  overlapClustered: -27,
  overlapStacked: 100,
  markerSize: 5,
  /** The hole in a doughnut, as a percentage of its radius. */
  holeSize: 75,
} as const

/**
 * Colour, in the order a chart decides it.
 *
 * A point that states its own wins — that is how a pie gets six colours out of
 * one series. Then the series' own. Only then the theme's accents, cycled, as
 * Office cycles them.
 */
interface Paint {
  accents: readonly string[]
  colorOf: (series: ChartSeries, seriesIndex: number, pointIndex: number, vary: boolean) => string
}

/** Office 2007's accents, for a chart with no theme to ask. */
const FALLBACK_ACCENTS = ['#4F81BD', '#C0504D', '#9BBB59', '#8064A2', '#4BACC6', '#F79646']

/**
 * The colours a chart's series take when they state none of their own.
 *
 * Exported because a panel that offers to change a series' colour has to show
 * the colour it has now, and a series with no colour of its own still has one:
 * the theme's, by position. A panel that showed a default instead would be
 * telling the user their green series is blue.
 */
export function themeAccents(theme: Theme | undefined, context: ColorContext): string[] {
  // The theme when there is one, and otherwise the scheme the context carries
  // — which is the same `a:clrScheme` by another route, and all an app that
  // has no theme object of its own needs to hand over.
  return Array.from({ length: 6 }, (_, index) => {
    const defined =
      theme?.colors.get(`accent${String(index + 1)}`) ??
      context.scheme.get(`accent${String(index + 1)}`)
    const resolved = defined === undefined ? null : resolveColor(defined, context)
    return resolved?.hex ?? FALLBACK_ACCENTS[index] ?? '#4F81BD'
  })
}

function paintFor(theme: Theme | undefined, context: ColorContext, offset: number): Paint {
  const accents = themeAccents(theme, context)
  const accentAt = (index: number): string => accents[index % 6] ?? '#4F81BD'

  // A theme colour is resolved here and never on the way back to the file, so
  // changing the deck's theme recolours the chart instead of baking today's
  // palette into it.
  const resolved = (color: Color | null): string | null =>
    color === null ? null : (resolveColor(color, context)?.hex ?? null)

  return {
    accents: Array.from({ length: 6 }, (_, index) => accentAt(index + offset)),
    colorOf: (series, seriesIndex, pointIndex, vary) => {
      const point = series.points.find((one) => one.index === pointIndex)
      return (
        resolved(point?.color ?? null) ??
        resolved(series.color) ??
        accentAt(offset + (vary ? pointIndex : seriesIndex))
      )
    },
  }
}

interface Plot {
  width: number
  height: number
  /** Room for the axis labels and the legend. */
  padding: { left: number; right: number; top: number; bottom: number }
}

/**
 * The scale one axis states, after the chart has had its say about it.
 *
 * `min` and `max` come from the file where the file gives them and from the
 * numbers where it does not. A chart that fixes its axis at 40 is drawn
 * differently from one that starts at zero, and both are ordinary.
 */
interface Scale {
  min: number
  max: number
  reversed: boolean
  ticks: number
  /** Drawn as shares of a whole rather than as numbers. */
  percent: boolean
}

const TICKS = 4

const spanOf = (values: readonly (number | null)[]): { min: number; max: number } => {
  const numbers = values.filter((value): value is number => value !== null)
  if (numbers.length === 0) return { min: 0, max: 1 }

  // Zero is included because a bar has to stand on something, which is what
  // Office does for every kind but a scatter.
  const max = Math.max(...numbers, 0)
  const min = Math.min(...numbers, 0)
  return max === min ? { min, max: min + 1 } : { min, max }
}

const stacked = (group: ChartPlot): boolean =>
  group.grouping === 'stacked' || group.grouping === 'percentStacked'

/** Each category's total, for the groups that pile their series up. */
function stackTotals(group: ChartPlot): number[] {
  const length = Math.max(...group.series.map((series) => series.values.length), 0)

  return Array.from({ length }, (_, index) =>
    group.series.reduce((sum, series) => sum + (series.values[index] ?? 0), 0),
  )
}

/**
 * How far the scale runs, for every group measured against it.
 *
 * A stacked group reaches as high as its totals, not as high as its tallest
 * series: three series of 40 stack to 120, and an axis that stopped at 40 would
 * draw them off the top of the chart.
 */
function scaleFor(groups: readonly ChartPlot[], axis: ChartAxis | undefined): Scale {
  const percent = groups.some((group) => group.grouping === 'percentStacked')
  const values = percent
    ? [0, 1]
    : groups.flatMap((group) =>
        stacked(group) ? stackTotals(group) : group.series.flatMap((series) => series.values),
      )

  const span = percent ? { min: 0, max: 1 } : spanOf(values)
  const min = axis?.min ?? span.min
  const max = axis?.max ?? span.max
  const unit = axis?.majorUnit ?? null

  return {
    min,
    max: max === min ? min + 1 : max,
    reversed: axis?.reversed ?? false,
    // A stated unit decides how many lines there are; without one, four gaps
    // is what a chart this size can carry without the labels touching.
    ticks:
      unit === null || unit <= 0
        ? TICKS
        : Math.min(Math.max(Math.round((max - min) / unit), 1), 10),
    percent,
  }
}

/** Where a value sits, top to bottom, on a scale that may run either way. */
function positionOf(scale: Scale, plot: Plot, value: number): number {
  const height = plot.height - plot.padding.top - plot.padding.bottom
  const share = (value - scale.min) / (scale.max - scale.min)
  return plot.padding.top + height * (scale.reversed ? share : 1 - share)
}

/** A number as a label: short enough to read on a chart the size of a thumbnail. */
const shown = (value: number, percent = false): string =>
  percent ? `${String(Math.round(value * 100))}%` : String(Math.round(value * 10) / 10)

function Axes({
  plot,
  scale,
  side = 'left',
  grid = true,
}: {
  plot: Plot
  scale: Scale
  /** The right-hand axis belongs to the second group, when there is one. */
  side?: 'left' | 'right'
  /** Only one axis draws the lines across; two sets would make a mesh. */
  grid?: boolean
}) {
  const { padding } = plot

  return (
    <g>
      {Array.from({ length: scale.ticks + 1 }, (_, index) => {
        const value = scale.min + ((scale.max - scale.min) * index) / scale.ticks
        const y = positionOf(scale, plot, value)

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
              {shown(value, scale.percent)}
            </text>
          </g>
        )
      })}
    </g>
  )
}

/**
 * The names along the bottom.
 *
 * Thinned rather than crowded: a chart the size of a thumbnail cannot hold
 * twenty labels, and Office turns them or drops them for the same reason. Every
 * nth is drawn so the ones that remain are evenly spaced.
 */
function Categories({
  plot,
  categories,
  bars,
}: {
  plot: Plot
  categories: readonly string[]
  /** Bars sit between the ticks; a line's points sit on them. */
  bars: boolean
}) {
  if (categories.length === 0) return null

  const { padding } = plot
  const width = plot.width - padding.left - padding.right
  const step = width / Math.max(bars ? categories.length : categories.length - 1, 1)
  const every = Math.ceil(categories.length / 8)

  return (
    <g>
      {categories.map((name, index) =>
        index % every !== 0 || name === '' ? null : (
          <text
            key={index}
            x={padding.left + step * index + (bars ? step / 2 : 0)}
            y={plot.height - padding.bottom + 10}
            textAnchor="middle"
            fontSize={9}
            fill={AXIS}
          >
            {name}
          </text>
        ),
      )}
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

/** The labels a series asks for, where it asks for something else than its group. */
const labelsFor = (group: ChartPlot, series: ChartSeries): DataLabels =>
  series.labels ?? group.labels

/**
 * How wide a bar is and where in its category it sits.
 *
 * `c:gapWidth` is the space between clusters as a percentage of one bar, and
 * `c:overlap` is how far the bars in a cluster cover each other. Both are
 * percentages of the bar, so the category's width is the sum of them and the
 * bars, and the bar falls out of that.
 */
function barLayout(group: ChartPlot, slot: number): { width: number; offset: number } {
  const count = Math.max(group.series.length, 1)
  const gap = (group.gapWidth ?? OFFICE.gapWidth) / 100
  const overlap =
    (group.overlap ?? (stacked(group) ? OFFICE.overlapStacked : OFFICE.overlapClustered)) / 100

  const units = count - (count - 1) * overlap + gap
  const width = slot / units

  return { width, offset: (width * gap) / 2 }
}

function Bars({
  group,
  categories,
  plot,
  scale,
  paint,
  offset,
}: {
  group: ChartPlot
  categories: readonly string[]
  plot: Plot
  scale: Scale
  paint: Paint
  /** Where this group's series start, so its colours carry on from the last one's. */
  offset: number
}) {
  const { padding } = plot
  const width = plot.width - padding.left - padding.right
  const points = Math.max(
    categories.length,
    ...group.series.map((series) => series.values.length),
    1,
  )
  const slot = width / points
  const bar = barLayout(group, slot)
  const piled = stacked(group)
  const totals = group.grouping === 'percentStacked' ? stackTotals(group) : null
  const zero = positionOf(scale, plot, Math.min(Math.max(0, scale.min), scale.max))

  // Where each series starts from when they are piled up: the sum of the ones
  // below it, per category, rather than the axis.
  const bases = group.series.map((_, seriesIndex) =>
    Array.from({ length: points }, (_, index) =>
      group.series
        .slice(0, seriesIndex)
        .reduce((sum, series) => sum + valueAt(series, index, totals?.[index]), 0),
    ),
  )

  return (
    <g>
      {group.series.map((series, seriesIndex) =>
        series.values.map((raw, index) => {
          if (raw === null) return null

          const value = valueAt(series, index, totals?.[index])
          const base = piled ? (bases[seriesIndex]?.[index] ?? 0) : 0
          const top = positionOf(scale, plot, base + value)
          const bottom = piled ? positionOf(scale, plot, base) : zero
          const x = piled
            ? padding.left + slot * index + bar.offset
            : padding.left +
              slot * index +
              bar.offset +
              bar.width * seriesIndex * (1 - (group.overlap ?? OFFICE.overlapClustered) / 100)

          return (
            <g key={`${String(seriesIndex)}-${String(index)}`}>
              <rect
                x={x}
                y={Math.min(top, bottom)}
                width={bar.width}
                height={Math.abs(bottom - top)}
                fill={paint.colorOf(series, offset + seriesIndex, index, group.varyColors)}
              />
              <PointLabel
                labels={labelsFor(group, series)}
                value={raw}
                category={categories[index]}
                x={x + bar.width / 2}
                y={Math.min(top, bottom) - 2}
              />
            </g>
          )
        }),
      )}
    </g>
  )
}

/** A point's height on the scale, which for a 100 % chart is its share of the category. */
function valueAt(series: ChartSeries, index: number, total: number | undefined): number {
  const value = series.values[index] ?? 0
  if (total === undefined) return value

  return total === 0 ? 0 : value / total
}

/**
 * Where a line goes through a blank.
 *
 * `c:dispBlanksAs` decides: a gap breaks the line, `zero` drops it to the
 * axis, and `span` bridges it. Three different pictures of the same numbers,
 * and the file is what says which one was meant.
 */
function segmentsOf(
  values: readonly (number | null)[],
  blanks: string | null,
): { value: number; index: number }[][] {
  const points = values.map((value, index) =>
    value === null && blanks === 'zero'
      ? { value: 0, index }
      : value === null
        ? null
        : { value, index },
  )

  if (blanks === 'span' || blanks === 'zero') {
    return [points.filter((point): point is { value: number; index: number } => point !== null)]
  }

  return points.reduce<{ value: number; index: number }[][]>(
    (runs, point) => {
      if (point === null) return [...runs, []]

      const last = runs[runs.length - 1] ?? []
      return [...runs.slice(0, -1), [...last, point]]
    },
    [[]],
  )
}

/** A smooth line through its points, as `c:smooth` asks for. */
function curveThrough(points: readonly { x: number; y: number }[]): string {
  return points
    .map((point, index) => {
      if (index === 0) return `M${String(point.x)},${String(point.y)}`

      const previous = points[index - 1] ?? point
      const before = points[index - 2] ?? previous
      const next = points[index + 1] ?? point

      // Catmull-Rom through the points, written as the cubic SVG draws: the
      // curve passes through every value rather than near it, which is what
      // makes it a reading of the data and not a decoration.
      const c1 = {
        x: previous.x + (point.x - before.x) / 6,
        y: previous.y + (point.y - before.y) / 6,
      }
      const c2 = { x: point.x - (next.x - previous.x) / 6, y: point.y - (next.y - previous.y) / 6 }

      return `C${String(c1.x)},${String(c1.y)} ${String(c2.x)},${String(c2.y)} ${String(point.x)},${String(point.y)}`
    })
    .join(' ')
}

function Lines({
  group,
  categories,
  plot,
  scale,
  paint,
  offset,
  filled,
  blanks,
}: {
  group: ChartPlot
  categories: readonly string[]
  plot: Plot
  scale: Scale
  paint: Paint
  offset: number
  filled: boolean
  blanks: string | null
}) {
  const { padding } = plot
  const width = plot.width - padding.left - padding.right
  const count = Math.max(categories.length, ...group.series.map((one) => one.values.length), 1)
  const step = width / Math.max(count - 1, 1)
  const piled = stacked(group)
  const totals = group.grouping === 'percentStacked' ? stackTotals(group) : null
  const bottom = plot.height - padding.bottom

  return (
    <g>
      {group.series.map((series, seriesIndex) => {
        const base = (index: number) =>
          piled
            ? group.series
                .slice(0, seriesIndex)
                .reduce((sum, one) => sum + valueAt(one, index, totals?.[index]), 0)
            : 0

        const colour = paint.colorOf(series, offset + seriesIndex, 0, false)
        const runs = segmentsOf(series.values, blanks).filter((run) => run.length > 0)
        const placed = runs.map((run) =>
          run.map((point) => ({
            x: padding.left + step * point.index,
            y: positionOf(
              scale,
              plot,
              base(point.index) + valueAt(series, point.index, totals?.[point.index]),
            ),
            value: point.value,
            index: point.index,
          })),
        )

        const marker = series.marker
        const shows = marker !== null && marker.symbol !== 'none'

        return (
          <g key={seriesIndex}>
            {placed.map((run, index) => {
              const path = series.smooth
                ? curveThrough(run)
                : run
                    .map(
                      (point, at) => `${at === 0 ? 'M' : 'L'}${String(point.x)},${String(point.y)}`,
                    )
                    .join(' ')

              return (
                <g key={index}>
                  {filled && (
                    <path
                      d={`${path} L${String(run[run.length - 1]?.x ?? 0)},${String(bottom)} L${String(run[0]?.x ?? 0)},${String(bottom)} Z`}
                      fill={colour}
                      fillOpacity={0.3}
                    />
                  )}
                  <path d={path} fill="none" stroke={colour} strokeWidth={2} />
                </g>
              )
            })}

            {placed.flat().map((point) => (
              <g key={point.index}>
                {shows && (
                  <circle
                    cx={point.x}
                    cy={point.y}
                    r={(marker.size ?? OFFICE.markerSize) / 2}
                    fill={colour}
                  />
                )}
                <PointLabel
                  labels={labelsFor(group, series)}
                  value={point.value}
                  category={categories[point.index]}
                  x={point.x}
                  y={point.y - 4}
                />
              </g>
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
  scale,
  across,
  paint,
  offset,
}: {
  group: ChartPlot
  plot: Plot
  scale: Scale
  across: { min: number; max: number }
  paint: Paint
  offset: number
}) {
  const { padding } = plot
  const width = plot.width - padding.left - padding.right
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
              y: positionOf(scale, plot, value),
              value,
              index,
            },
          ]
        })
        if (points.length === 0) return null

        const colour = paint.colorOf(series, offset + seriesIndex, 0, false)
        const size = (series.marker?.size ?? OFFICE.markerSize) / 2

        return (
          <g key={seriesIndex}>
            {joined && (
              <path
                d={
                  series.smooth
                    ? curveThrough(points)
                    : points
                        .map(
                          (point, index) =>
                            `${index === 0 ? 'M' : 'L'}${String(point.x)},${String(point.y)}`,
                        )
                        .join(' ')
                }
                fill="none"
                stroke={colour}
                strokeWidth={2}
              />
            )}
            {points.map((point) => (
              <g key={point.index}>
                {series.marker?.symbol !== 'none' && (
                  <circle cx={point.x} cy={point.y} r={size} fill={colour} />
                )}
                <PointLabel
                  labels={labelsFor(group, series)}
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
function AcrossAxis({ plot, across }: { plot: Plot; across: { min: number; max: number } }) {
  const { padding } = plot
  const width = plot.width - padding.left - padding.right

  return (
    <g>
      {Array.from({ length: TICKS + 1 }, (_, index) => {
        const x = padding.left + (width * index) / TICKS
        const value = across.min + ((across.max - across.min) * index) / TICKS

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
  paint,
  offset,
  doughnut,
}: {
  group: ChartPlot
  categories: readonly string[]
  plot: Plot
  paint: Paint
  offset: number
  doughnut: boolean
}) {
  const series = group.series[0]
  const values = (series?.values ?? []).map((value) => value ?? 0)
  const total = values.reduce((sum, value) => sum + Math.abs(value), 0)
  if (series === undefined || total === 0) return null

  const cx = plot.width / 2
  const cy = plot.height / 2
  const radius = Math.min(plot.width, plot.height) / 2 - 8
  const inner = doughnut ? (radius * (group.holeSize ?? OFFICE.holeSize)) / 100 : 0

  // Twelve o'clock, unless the chart turns its first slice elsewhere.
  const start = -Math.PI / 2 + ((group.firstSliceAngle ?? 0) * Math.PI) / 180

  // Each slice starts where the ones before it ended. Computed rather than
  // accumulated in a variable: a component must not carry state between its
  // own statements, and a running total reads as if it might.
  const starts = values.reduce<number[]>(
    (angles, value) => [
      ...angles,
      (angles[angles.length - 1] ?? start) + (Math.abs(value) / total) * Math.PI * 2,
    ],
    [start],
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
            {/* A pie colours its points, not its series, whatever `c:varyColors` says. */}
            <path d={path} fill={paint.colorOf(series, offset, index, true)} />
            <PointLabel
              labels={labelsFor(group, series)}
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

/**
 * A radar, which is a line chart bent into a circle.
 *
 * Every category is a spoke and every series a closed shape across them. Drawn
 * on its own grid of rings rather than on the cartesian axes: the scale is the
 * same, the geometry is not.
 */
function Radar({
  group,
  categories,
  plot,
  scale,
  paint,
  offset,
}: {
  group: ChartPlot
  categories: readonly string[]
  plot: Plot
  scale: Scale
  paint: Paint
  offset: number
}) {
  const count = Math.max(categories.length, ...group.series.map((one) => one.values.length), 0)
  if (count === 0) return null

  const cx = plot.width / 2
  const cy = (plot.height - plot.padding.bottom + plot.padding.top) / 2
  const radius = Math.min(plot.width, plot.height - plot.padding.bottom) / 2 - 12

  const angle = (index: number) => -Math.PI / 2 + (index / count) * Math.PI * 2
  const at = (index: number, value: number) => {
    const share = Math.max(Math.min((value - scale.min) / (scale.max - scale.min), 1), 0)
    return {
      x: cx + Math.cos(angle(index)) * radius * share,
      y: cy + Math.sin(angle(index)) * radius * share,
    }
  }

  const filled = group.radarStyle === 'filled'

  return (
    <g>
      {Array.from({ length: TICKS }, (_, ring) => (
        <polygon
          key={ring}
          points={Array.from({ length: count }, (_, index) => {
            const r = (radius * (ring + 1)) / TICKS
            return `${String(cx + Math.cos(angle(index)) * r)},${String(cy + Math.sin(angle(index)) * r)}`
          }).join(' ')}
          fill="none"
          stroke={GRID}
          strokeWidth={1}
        />
      ))}

      {categories.map((name, index) =>
        name === '' ? null : (
          <text
            key={index}
            x={cx + Math.cos(angle(index)) * (radius + 8)}
            y={cy + Math.sin(angle(index)) * (radius + 8) + 3}
            textAnchor="middle"
            fontSize={8}
            fill={AXIS}
          >
            {name}
          </text>
        ),
      )}

      {group.series.map((series, seriesIndex) => {
        const colour = paint.colorOf(series, offset + seriesIndex, 0, false)
        const points = Array.from({ length: count }, (_, index) =>
          at(index, series.values[index] ?? 0),
        )

        return (
          <polygon
            key={seriesIndex}
            points={points.map((point) => `${String(point.x)},${String(point.y)}`).join(' ')}
            fill={filled ? colour : 'none'}
            fillOpacity={filled ? 0.3 : undefined}
            stroke={colour}
            strokeWidth={2}
          />
        )
      })}
    </g>
  )
}

function Legend({ chart, plot, paint }: { chart: Chart; plot: Plot; paint: Paint }) {
  if (chart.legend === null) return null

  const kind = chartKind(chart)
  const round = kind === 'pie' || kind === 'doughnut'
  const series = allSeries(chart)
  const first = series[0]

  const entries = round
    ? chart.categories.map((name, index) => ({
        name,
        color: first === undefined ? AXIS : paint.colorOf(first, 0, index, true),
      }))
    : series.map((one, index) => ({
        name: one.name ?? `Series ${String(index + 1)}`,
        color: paint.colorOf(one, index, 0, false),
      }))

  return (
    <g transform={`translate(0 ${String(plot.height - 12)})`}>
      {entries.map((entry, index) => (
        <g key={entry.name} transform={`translate(${String(8 + index * 90)} 0)`}>
          <rect width={8} height={8} y={-8} fill={entry.color} />
          <text x={12} fontSize={9} fill={AXIS}>
            {entry.name}
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
  scale,
  across,
  paint,
  offset,
}: {
  group: ChartPlot
  chart: Chart
  plot: Plot
  scale: Scale
  across: { min: number; max: number }
  paint: Paint
  offset: number
}) {
  switch (group.kind) {
    case 'bar':
      return (
        <Bars
          group={group}
          categories={chart.categories}
          plot={plot}
          scale={scale}
          paint={paint}
          offset={offset}
        />
      )
    case 'line':
    case 'area':
      return (
        <Lines
          group={group}
          categories={chart.categories}
          plot={plot}
          scale={scale}
          paint={paint}
          offset={offset}
          filled={group.kind === 'area'}
          blanks={chart.blanks}
        />
      )
    case 'scatter':
      return (
        <Scatter
          group={group}
          plot={plot}
          scale={scale}
          across={across}
          paint={paint}
          offset={offset}
        />
      )
    case 'pie':
    case 'doughnut':
      return (
        <Pie
          group={group}
          categories={chart.categories}
          plot={plot}
          paint={paint}
          offset={offset}
          doughnut={group.kind === 'doughnut'}
        />
      )
    case 'radar':
      return (
        <Radar
          group={group}
          categories={chart.categories}
          plot={plot}
          scale={scale}
          paint={paint}
          offset={offset}
        />
      )
    default:
      return null
  }
}

/** Whether a kind is drawn against a pair of axes rather than in a circle. */
const onAxes = (plot: ChartPlot): boolean =>
  plot.kind === 'bar' || plot.kind === 'line' || plot.kind === 'area' || plot.kind === 'scatter'

/** The kinds this renderer draws; the rest are framed and named. */
const drawable = (plot: ChartPlot): boolean =>
  onAxes(plot) || plot.kind === 'pie' || plot.kind === 'doughnut' || plot.kind === 'radar'

/**
 * The plot, moved to where the chart says it should be.
 *
 * A manual layout states fractions of the chart's frame, so it is read as
 * padding: the room left around the plotting rectangle. `outer` includes the
 * axis labels in what it measures, so the label allowance is taken out of the
 * inside of it; `inner` is the plotting rectangle itself and is used as given.
 *
 * A chart that states only some of the four keeps the automatic answer for the
 * rest, which is what Office does with a plot area dragged sideways but not
 * resized.
 */
function placedPlot(plot: Plot, layout: ManualLayout | null): Plot {
  if (layout === null) return plot

  const labels = layout.target === 'outer' ? { left: 34, bottom: 18, top: 0, right: 0 } : null
  const left = layout.x === null ? plot.padding.left : layout.x * plot.width + (labels?.left ?? 0)
  const top = layout.y === null ? plot.padding.top : layout.y * plot.height + (labels?.top ?? 0)

  const right =
    layout.x === null || layout.width === null
      ? plot.padding.right
      : Math.max(plot.width - (layout.x + layout.width) * plot.width + (labels?.right ?? 0), 0)

  const bottom =
    layout.y === null || layout.height === null
      ? plot.padding.bottom
      : Math.max(plot.height - (layout.y + layout.height) * plot.height + (labels?.bottom ?? 0), 0)

  // A layout that leaves no room to draw in is one nobody meant; the automatic
  // padding is a worse picture than a chart with no picture at all.
  const room = plot.width - left - right > 20 && plot.height - top - bottom > 20
  return room ? { ...plot, padding: { left, top, right, bottom } } : plot
}

/** The value axis a set of groups is measured against, of the pair they name. */
function valueAxisOf(chart: Chart, groups: readonly ChartPlot[]): ChartAxis | undefined {
  const ids = new Set(groups.flatMap((group) => group.axisIds))
  return chart.axes.find((axis) => axis.kind === 'value' && ids.has(axis.id))
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

  const paint = paintFor(theme, context, 0)
  const placed = placedPlot(plot, chart.plotLayout)

  const primaryPlots = chart.plots.filter((one) => !one.secondary)
  const scales = {
    primary: scaleFor(primaryPlots, valueAxisOf(chart, primaryPlots)),
    secondary:
      secondary === undefined ? null : scaleFor([secondary], valueAxisOf(chart, [secondary])),
  }
  const across = spanOf(allSeries(chart).flatMap((one) => one.xValues ?? []))

  const scatter = chart.plots.some((one) => one.kind === 'scatter')
  const drawn = chart.plots.filter((one) => onAxes(one) && drawable(one))
  const categoryAxis = chart.axes.find((axis) => axis.kind === 'category' || axis.kind === 'date')

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

      {drawn.length > 0 && <Axes plot={placed} scale={scales.primary} />}
      {scales.secondary !== null && (
        <Axes plot={placed} scale={scales.secondary} side="right" grid={false} />
      )}
      {scatter && <AcrossAxis plot={placed} across={across} />}
      {!scatter && drawn.length > 0 && categoryAxis?.hidden !== true && (
        <Categories
          plot={placed}
          categories={chart.categories}
          bars={drawn.some((one) => one.kind === 'bar')}
        />
      )}

      {chart.plots.map((group, index) => (
        <Group
          key={index}
          group={group}
          chart={chart}
          plot={placed}
          scale={group.secondary && scales.secondary !== null ? scales.secondary : scales.primary}
          across={across}
          paint={paint}
          offset={offsets[index] ?? 0}
        />
      ))}

      {!chart.plots.some(drawable) && (
        <text x={plot.width / 2} y={plot.height / 2} textAnchor="middle" fontSize={11} fill={AXIS}>
          {chart.unsupported?.label ?? 'Chart'}
        </text>
      )}

      <Legend chart={chart} plot={placed} paint={paint} />
    </svg>
  )
}
