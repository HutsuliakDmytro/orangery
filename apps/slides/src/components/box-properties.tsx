import { autofitKindOf, EMU_PER_POINT, writeBodyProperties } from '@orangery/ooxml-drawingml'
import type { AutofitKind } from '@orangery/ooxml-drawingml'
import type { Shape } from '@orangery/ooxml-presentation'
import { currentSlide, useDeckStore } from '../store/deck-store'

/**
 * How the selected shape holds its text: the box, not the words.
 *
 * Nothing here writes a default in place of an absent value. A shape with no
 * anchor takes the one its placeholder gives it, and the two look alike on this
 * slide and stop looking alike the moment the layout changes — so "From layout"
 * removes the attribute rather than writing the answer it has today.
 */

const ANCHORS = [
  ['t', 'Top'],
  ['ctr', 'Middle'],
  ['b', 'Bottom'],
] as const

const AUTOFIT: readonly [AutofitKind, string][] = [
  ['none', 'Do not autofit'],
  ['shrink', 'Shrink text on overflow'],
  ['shape', 'Resize shape to fit text'],
]

/** Insets are EMU in the file and points everywhere a person reads them. */
const points = (emu: number | null) => (emu === null ? '' : Math.round(emu / EMU_PER_POINT))

export function BoxProperties({ shapes }: { shapes: readonly Shape[] }) {
  const edit = useDeckStore((state) => state.edit)
  const slide = useDeckStore(currentSlide)

  const withText = shapes.filter((shape) => shape.text !== null)
  const first = withText[0]
  if (slide === null || first?.text == null) return null

  const properties = first.text.bodyProperties
  const ids = withText.map((shape) => shape.id)

  const apply = (change: Parameters<typeof writeBodyProperties>[1]) => {
    edit((edited) =>
      edited.shapes
        .filter((shape) => ids.includes(shape.id))
        .map((shape) =>
          shape.text === null ? false : writeBodyProperties(shape.text.node, change),
        )
        .reduce((changed: boolean, one) => changed || one, false),
    )
  }

  const inset = (side: 'left' | 'top' | 'right' | 'bottom') => (
    <input
      key={side}
      type="number"
      aria-label={`Inset ${side}`}
      value={points(properties?.insets[side] ?? null)}
      min={0}
      step={1}
      onChange={(event) => {
        const value = event.target.value
        apply({
          insets: { [side]: value === '' ? null : Number(value) * EMU_PER_POINT },
        })
      }}
      className="w-12 rounded border border-border bg-surface px-1 py-0.5 text-text"
    />
  )

  return (
    <section aria-label="Text box" className="space-y-2">
      <h2 className="uppercase tracking-wide text-muted">Text box</h2>

      <div className="flex items-center gap-2">
        <select
          aria-label="Vertical anchor"
          value={properties?.anchor ?? ''}
          onChange={(event) => {
            const value = event.target.value
            apply({ anchor: value === '' ? null : (value as 't' | 'ctr' | 'b') })
          }}
          className="min-w-0 flex-1 rounded border border-border bg-surface px-1 py-0.5 text-text"
        >
          <option value="">From layout</option>
          {ANCHORS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-1 text-muted">
          <input
            type="checkbox"
            aria-label="Wrap text in shape"
            checked={properties?.wrap !== 'none'}
            onChange={(event) => {
              apply({ wrap: event.target.checked ? 'square' : 'none' })
            }}
          />
          Wrap
        </label>
      </div>

      <select
        aria-label="Autofit"
        value={autofitKindOf(first.text.node) ?? ''}
        onChange={(event) => {
          const value = event.target.value
          apply({ autofit: value === '' ? null : (value as AutofitKind) })
        }}
        className="w-full rounded border border-border bg-surface px-1 py-0.5 text-text"
      >
        <option value="">From layout</option>
        {AUTOFIT.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <div className="flex items-center gap-1">
        {(['left', 'top', 'right', 'bottom'] as const).map((side) => inset(side))}
      </div>

      <select
        aria-label="Columns"
        value={String(properties?.columns?.count ?? 1)}
        onChange={(event) => {
          const count = Number(event.target.value)
          // One column is not a column count, it is the absence of one, and
          // writing `numCol="1"` would state the default as a decision.
          apply({ columns: count <= 1 ? null : { count } })
        }}
        className="w-full rounded border border-border bg-surface px-1 py-0.5 text-text"
      >
        {[1, 2, 3, 4].map((count) => (
          <option key={count} value={String(count)}>
            {count === 1 ? 'One column' : `${String(count)} columns`}
          </option>
        ))}
      </select>
    </section>
  )
}
