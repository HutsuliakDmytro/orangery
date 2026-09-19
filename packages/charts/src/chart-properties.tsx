import { allSeries, chartKind } from './chart'
import type { Chart, ChartKind } from './chart'
import type { ChartEdit } from './chart-edit'

/**
 * The controls behind a chart: what kind it is, what it shows, how it is scaled.
 *
 * Presentational on purpose. It is handed a chart and a way to say what should
 * change, and knows nothing about packages, undo or which app it is in — so the
 * deck and the document show the same panel rather than two that drift.
 *
 * Everything acts on the first group of the plot area. A combination chart has
 * more than one, and the second is a separate question this does not ask yet;
 * changing the first is what "change the chart type" means to everybody else.
 */

export interface ChartPropertiesProps {
  chart: Chart
  onEdit: (edits: readonly ChartEdit[]) => void
  /**
   * The theme's accents, in order, from `themeAccents`.
   *
   * A series almost never states a colour: it takes the theme's by position,
   * and that is what it is drawn in. Without these the panel would show one
   * default for every series and invite somebody to replace a colour they
   * could not see with one they did not choose.
   */
  palette?: readonly string[]
}

const KINDS: { value: Exclude<ChartKind, 'unsupported'>; label: string }[] = [
  { value: 'bar', label: 'Column' },
  { value: 'line', label: 'Line' },
  { value: 'area', label: 'Area' },
  { value: 'pie', label: 'Pie' },
  { value: 'doughnut', label: 'Doughnut' },
  { value: 'scatter', label: 'Scatter' },
  { value: 'radar', label: 'Radar' },
]

/** Line and area stack the same way, and neither of them clusters. */
const STACKING = [
  { value: 'standard', label: 'None' },
  { value: 'stacked', label: 'Stacked' },
  { value: 'percentStacked', label: '100% stacked' },
]

/**
 * How a group piles its series up, by kind.
 *
 * `clustered` belongs to bar charts alone — the schema calls the rest of them
 * `ST_Grouping` and has no such value — so offering it for a line chart would
 * write a file Excel offers to repair. A line's equivalent is `standard`,
 * which is the absence of stacking rather than a way of doing it, and is
 * labelled as such.
 */
const GROUPINGS: Readonly<Record<string, { value: string; label: string }[]>> = {
  bar: [
    { value: 'clustered', label: 'Clustered' },
    { value: 'stacked', label: 'Stacked' },
    { value: 'percentStacked', label: '100% stacked' },
  ],
  line: STACKING,
  area: STACKING,
}

/** What a kind means by "not stacked", which is not the same word twice. */
const UNSTACKED = (kind: string): string => (kind === 'bar' ? 'clustered' : 'standard')

const LEGENDS = [
  { value: '', label: 'None' },
  { value: 'r', label: 'Right' },
  { value: 'l', label: 'Left' },
  { value: 't', label: 'Top' },
  { value: 'b', label: 'Bottom' },
]

const LABELS = [
  { key: 'values', label: 'Values' },
  { key: 'categories', label: 'Category names' },
  { key: 'seriesName', label: 'Series names' },
  { key: 'percentages', label: 'Percentages' },
] as const

const field = 'flex items-center justify-between gap-2'
const input =
  'w-24 rounded border border-border bg-transparent px-1 py-0.5 text-text outline-none focus:border-accent'

/** A number the chart states, or nothing at all, which means Office decides. */
const shown = (value: number | null): string => (value === null ? '' : String(value))

export function ChartProperties({ chart, onEdit, palette = [] }: ChartPropertiesProps) {
  const plot = chart.plots[0]
  const kind = chartKind(chart)
  const series = allSeries(chart)

  // The scale a chart is measured against. A pie has none, and asking a pie
  // where its axis starts is asking about something that is not there.
  const axis = chart.axes.find((one) => one.kind === 'value' && !one.secondary)

  if (plot === undefined) return null

  const grouped = kind === 'bar' || kind === 'line' || kind === 'area'
  const labels = plot.labels

  return (
    <section aria-label="Chart properties" className="space-y-2 text-xs">
      <label className={field}>
        <span className="text-muted">Type</span>
        <select
          aria-label="Chart type"
          value={kind === 'unsupported' ? '' : kind}
          onChange={(event) => {
            const to = event.target.value as Exclude<ChartKind, 'unsupported'>
            onEdit([{ kind: 'plotType', plot: 0, to }])
          }}
          className={input}
        >
          {kind === 'unsupported' && <option value="">Unsupported</option>}
          {KINDS.map((one) => (
            <option key={one.value} value={one.value}>
              {one.label}
            </option>
          ))}
        </select>
      </label>

      {kind === 'bar' && (
        <label className={field}>
          <span className="text-muted">Bars</span>
          <select
            aria-label="Bar direction"
            value={plot.direction ?? 'col'}
            onChange={(event) => {
              onEdit([{ kind: 'plotType', plot: 0, to: 'bar', direction: event.target.value }])
            }}
            className={input}
          >
            <option value="col">Vertical</option>
            <option value="bar">Horizontal</option>
          </select>
        </label>
      )}

      {grouped && (
        <label className={field}>
          <span className="text-muted">Stacking</span>
          <select
            aria-label="Stacking"
            // What the chart says, and where it says nothing, what the kind
            // means by not stacked — which is a different word per kind.
            value={plot.grouping ?? UNSTACKED(kind)}
            onChange={(event) => {
              onEdit([{ kind: 'plotType', plot: 0, to: kind, grouping: event.target.value }])
            }}
            className={input}
          >
            {(GROUPINGS[kind] ?? []).map((one) => (
              <option key={one.value} value={one.value}>
                {one.label}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className={field}>
        <span className="text-muted">Legend</span>
        <select
          aria-label="Legend"
          value={chart.legend ?? ''}
          onChange={(event) => {
            const position = event.target.value
            onEdit([{ kind: 'legend', position: position === '' ? null : position }])
          }}
          className={input}
        >
          {LEGENDS.map((one) => (
            <option key={one.value} value={one.value}>
              {one.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="space-y-1">
        <legend className="text-muted">Labels</legend>
        {LABELS.map((one) => (
          <label key={one.key} className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={labels[one.key]}
              onChange={(event) => {
                onEdit([{ kind: 'labels', plot: 0, show: { [one.key]: event.target.checked } }])
              }}
              className="accent-accent"
            />
            <span>{one.label}</span>
          </label>
        ))}
      </fieldset>

      {axis !== undefined && (
        <fieldset className="space-y-1">
          <legend className="text-muted">Value axis</legend>

          <label className={field}>
            <span className="text-muted">Title</span>
            <input
              type="text"
              aria-label="Axis title"
              defaultValue={axis.title ?? ''}
              onBlur={(event) => {
                const text = event.target.value.trim()
                if (text === (axis.title ?? '')) return
                onEdit([{ kind: 'axis', id: axis.id, title: text === '' ? null : text }])
              }}
              className={input}
            />
          </label>

          {(
            [
              ['Minimum', 'min'],
              ['Maximum', 'max'],
              ['Step', 'majorUnit'],
            ] as const
          ).map(([label, property]) => (
            <label key={property} className={field}>
              <span className="text-muted">{label}</span>
              <input
                type="number"
                aria-label={label}
                // Empty means the chart states nothing and Office decides,
                // which is a different thing from a stated zero.
                placeholder="Auto"
                defaultValue={shown(axis[property])}
                onBlur={(event) => {
                  const text = event.target.value.trim()
                  const value = text === '' ? null : Number(text)
                  if (value !== null && !Number.isFinite(value)) return
                  if (value === axis[property]) return

                  onEdit([{ kind: 'axis', id: axis.id, [property]: value }])
                }}
                className={input}
              />
            </label>
          ))}

          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={axis.hidden}
              onChange={(event) => {
                onEdit([{ kind: 'axis', id: axis.id, hidden: event.target.checked }])
              }}
              className="accent-accent"
            />
            <span>Hide the axis</span>
          </label>
        </fieldset>
      )}

      <fieldset className="space-y-1">
        <legend className="text-muted">Series</legend>
        {series.map((one, index) => {
          const name = one.name ?? `Series ${String(index + 1)}`
          const own = one.color?.source.kind === 'srgb' ? one.color.source.hex : null

          return (
            <label key={index} className={field}>
              <span className="truncate text-muted">{name}</span>

              <span className="flex items-center gap-1">
                {own !== null && (
                  // The way back. Replacing a theme colour with a fixed one
                  // detaches the series from the theme for good, and without
                  // this the only one-way door in the panel would be the one
                  // people reach for first.
                  <button
                    type="button"
                    aria-label={`Use the theme colour for ${name}`}
                    onClick={() => {
                      onEdit([{ kind: 'seriesColor', series: index, color: null }])
                    }}
                    className="rounded border border-border px-1 text-[10px] text-muted hover:border-accent"
                  >
                    Theme
                  </button>
                )}
                <input
                  type="color"
                  aria-label={`Colour of ${name}`}
                  // Its own where it states one, and otherwise the colour it is
                  // actually drawn in: the theme's accent for its position.
                  value={own ?? palette[index % Math.max(palette.length, 1)] ?? '#4F81BD'}
                  onChange={(event) => {
                    onEdit([
                      {
                        kind: 'seriesColor',
                        series: index,
                        color: {
                          source: { kind: 'srgb', hex: event.target.value.toUpperCase() },
                          transforms: [],
                        },
                      },
                    ])
                  }}
                  className="h-5 w-10 rounded border border-border bg-transparent"
                />
              </span>
            </label>
          )
        })}
      </fieldset>
    </section>
  )
}
