import { resolveColor } from '@orangery/ooxml-drawingml'
import type { Color, ColorContext, Fill, GradientStop } from '@orangery/ooxml-drawingml'
import { ColorControl } from './color-control'

/**
 * The stops of a gradient, and which way it runs.
 *
 * A gradient is a list of colours at positions, and until now the app could
 * make one and never change it — two stops, from whatever the shape was to
 * white, for ever. Everything here rebuilds the whole fill and hands it to the
 * same writer that already took one, so nothing new writes to the file.
 *
 * Positions are shown as percentages because that is how anybody says where a
 * stop is; the file counts in thousandths of a percent and this is the only
 * place that has to know.
 */

/** The eight angles anybody picks, in the sixty-thousandths DrawingML counts. */
const ANGLES = [
  ['→', 0],
  ['↘', 45],
  ['↓', 90],
  ['↙', 135],
  ['←', 180],
  ['↖', 225],
  ['↑', 270],
  ['↗', 315],
] as const

export function GradientEditor({
  fill,
  context,
  onChange,
}: {
  fill: Extract<Fill, { kind: 'gradient' }>
  context: ColorContext
  onChange: (fill: Fill) => void
}) {
  const stops = [...fill.stops].sort((a, b) => a.position - b.position)

  const replace = (index: number, stop: GradientStop) => {
    onChange({ ...fill, stops: stops.map((one, at) => (at === index ? stop : one)) })
  }

  const hexOf = (color: Color | null) =>
    color === null ? null : (resolveColor(color, context)?.hex ?? null)

  return (
    <div className="space-y-2" role="group" aria-label="Gradient">
      <div className="flex flex-wrap gap-1">
        {ANGLES.map(([arrow, degrees]) => (
          <button
            key={degrees}
            type="button"
            aria-label={`Gradient ${String(degrees)} degrees`}
            aria-pressed={Math.round((fill.angle ?? 0) / 60000) === degrees}
            onClick={() => {
              onChange({ ...fill, angle: degrees * 60000 })
            }}
            className="h-5 w-5 rounded border border-border text-text"
          >
            {arrow}
          </button>
        ))}
      </div>

      {stops.map((stop, index) => (
        <div key={index} className="space-y-1 border-l border-border pl-2">
          <div className="flex items-center gap-2">
            <label className="flex flex-1 items-center gap-1 text-muted">
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(stop.position * 100)}
                aria-label={`Stop ${String(index + 1)} position`}
                onChange={(event) => {
                  replace(index, { ...stop, position: Number(event.target.value) / 100 })
                }}
                className="flex-1"
              />
              {`${String(Math.round(stop.position * 100))}%`}
            </label>

            <button
              type="button"
              aria-label={`Remove stop ${String(index + 1)}`}
              // Two is the fewest a gradient can have and still be one; below
              // that it is a colour, and the panel above already does colours.
              disabled={stops.length <= 2}
              onClick={() => {
                onChange({ ...fill, stops: stops.filter((_, at) => at !== index) })
              }}
              className="rounded border border-border px-1 text-muted disabled:opacity-40"
            >
              −
            </button>
          </div>

          <ColorControl
            label={`Stop ${String(index + 1)}`}
            selected={hexOf(stop.color)}
            onPick={(color) => {
              replace(index, { ...stop, color })
            }}
            onClear={() => {
              replace(index, { ...stop, color: null })
            }}
          />
        </div>
      ))}

      <button
        type="button"
        aria-label="Add stop"
        onClick={() => {
          // Halfway along, taking the colour of the stop before it: a new stop
          // that changed the gradient's look would be a stop nobody asked for.
          const last = stops.at(-1)
          onChange({
            ...fill,
            stops: [...stops, { position: 0.5, color: last?.color ?? null }],
          })
        }}
        className="rounded border border-border px-1.5 py-0.5 text-muted"
      >
        Add stop
      </button>
    </div>
  )
}
