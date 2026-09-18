import {
  addEffect,
  flatten,
  moveStep,
  readAnimations,
  removeEffect,
  setEffectTiming,
} from '@orangery/ooxml-presentation'
import type { EffectName, Trigger } from '@orangery/ooxml-presentation'
import { currentSlide, useDeckStore } from '../store/deck-store'

/**
 * What the slide plays, and in what order.
 *
 * The whole slide rather than the selected shape: an animation is a thing that
 * happens after something else, and a list showing one shape's effects would
 * hide the only fact that matters about them. PowerPoint's pane does the same.
 *
 * Only the effects this app can write are offered. A fly-in is stated as motion
 * on the shape's own position, and offering to make one we would get wrong is
 * worse than not offering it — reading a deck that has one still works.
 */

const ENTRANCES: readonly (readonly [EffectName, string])[] = [
  ['appear', 'Appear'],
  ['fade', 'Fade'],
  ['wipe', 'Wipe'],
  ['zoom', 'Zoom'],
]

const TRIGGERS: readonly (readonly [Trigger, string])[] = [
  ['click', 'On click'],
  ['with', 'With previous'],
  ['after', 'After previous'],
]

/** Milliseconds, as the three speeds PowerPoint names. */
const SPEEDS: readonly (readonly [number, string])[] = [
  [500, 'Fast'],
  [1000, 'Medium'],
  [2000, 'Slow'],
]

export function AnimationPanel() {
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)
  const selection = useDeckStore((state) => state.selection)
  const edit = useDeckStore((state) => state.edit)

  if (open === null || slide === null) return null

  const steps = readAnimations(slide)
  const named = new Map(
    flatten(slide.shapes).map((shape) => [shape.id, shape.name === '' ? 'Shape' : shape.name]),
  )

  const add = (name: EffectName, kind: 'entrance' | 'exit' | 'emphasis') => {
    for (const shapeId of selection) {
      edit((part) => addEffect(part, { shapeId, name, kind, trigger: 'click' }))
    }
  }

  return (
    <section aria-label="Animation" className="space-y-2 text-xs">
      <h2 className="uppercase tracking-wide text-muted">Animation</h2>

      {selection.length === 0 ? (
        <p className="text-muted">Pick a shape to animate it.</p>
      ) : (
        <div className="space-y-1">
          <div className="flex flex-wrap gap-1">
            {ENTRANCES.map(([name, label]) => (
              <button
                key={name}
                type="button"
                aria-label={`Add entrance ${label.toLowerCase()}`}
                onClick={() => {
                  add(name, 'entrance')
                }}
                className="rounded border border-border px-1.5 py-0.5 text-text hover:border-accent"
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              aria-label="Add emphasis pulse"
              onClick={() => {
                add('pulse', 'emphasis')
              }}
              className="rounded border border-border px-1.5 py-0.5 text-muted hover:border-accent"
            >
              Pulse
            </button>
            <button
              type="button"
              aria-label="Add exit fade"
              onClick={() => {
                add('fade', 'exit')
              }}
              className="rounded border border-border px-1.5 py-0.5 text-muted hover:border-accent"
            >
              Fade out
            </button>
          </div>
        </div>
      )}

      {steps.length === 0 ? (
        <p className="text-muted">This slide plays nothing.</p>
      ) : (
        <ol className="space-y-1">
          {steps.map((step, index) =>
            step.effects.map((effect) => (
              <li
                key={effect.id}
                className="space-y-1 rounded border border-border p-1"
                aria-label={`Effect ${String(index + 1)}`}
              >
                <div className="flex items-center gap-1">
                  {/* The number is the press it happens on, which is the only
                      thing about an effect that is not about one shape. */}
                  <span className="w-4 shrink-0 text-muted">{index + 1}</span>
                  <span className="min-w-0 flex-1 truncate text-text">
                    {named.get(effect.shapeId ?? -1) ?? 'Shape'} — {effect.kind}
                  </span>
                  <button
                    type="button"
                    aria-label={`Move effect ${String(index + 1)} earlier`}
                    disabled={index === 0}
                    onClick={() => {
                      edit((part) => moveStep(part, index, index - 1))
                    }}
                    className="rounded border border-border px-1 text-muted disabled:opacity-40"
                  >
                    ↑
                  </button>
                  <button
                    type="button"
                    aria-label={`Move effect ${String(index + 1)} later`}
                    disabled={index === steps.length - 1}
                    onClick={() => {
                      edit((part) => moveStep(part, index, index + 1))
                    }}
                    className="rounded border border-border px-1 text-muted disabled:opacity-40"
                  >
                    ↓
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove effect ${String(index + 1)}`}
                    onClick={() => {
                      edit((part) => removeEffect(part, effect.id))
                    }}
                    className="rounded border border-border px-1 text-muted"
                  >
                    ×
                  </button>
                </div>

                <div className="flex gap-1 pl-5">
                  <select
                    aria-label={`Effect ${String(index + 1)} starts`}
                    value={effect.trigger}
                    onChange={(event) => {
                      const trigger = event.target.value as Trigger
                      edit((part) => setEffectTiming(part, effect.id, { trigger }))
                    }}
                    className="min-w-0 flex-1 rounded border border-border bg-transparent px-1 py-0.5 text-muted"
                  >
                    {TRIGGERS.map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label={`Effect ${String(index + 1)} speed`}
                    value={String(effect.duration ?? 500)}
                    onChange={(event) => {
                      const duration = Number(event.target.value)
                      edit((part) => setEffectTiming(part, effect.id, { duration }))
                    }}
                    className="rounded border border-border bg-transparent px-1 py-0.5 text-muted"
                  >
                    {SPEEDS.every(([value]) => value !== (effect.duration ?? 500)) && (
                      <option value={String(effect.duration ?? 500)}>
                        {`${String(Math.round((effect.duration ?? 500) / 100) / 10)}s`}
                      </option>
                    )}
                    {SPEEDS.map(([value, label]) => (
                      <option key={value} value={String(value)}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            )),
          )}
        </ol>
      )}
    </section>
  )
}
