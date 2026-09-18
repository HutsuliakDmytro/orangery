import { writeFill, writeLine } from '@orangery/ooxml-presentation'
import { resolveColor } from '@orangery/ooxml-drawingml'
import { colorContextFor, lookContext, shapeLook } from '@orangery/ooxml-presentation'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { SlideProperties } from './slide-properties'
import { BoxProperties } from './box-properties'
import { TextProperties } from './text-properties'

/**
 * What the selection looks like, and how to change it.
 *
 * Colours are written as literal values rather than theme slots. Picking
 * "accent 2" from a palette is a different action from picking a colour, and
 * offering only the second is honest about which one this is; the theme picker
 * comes with the theme gallery.
 */

const SWATCHES = [
  '#000000',
  '#FFFFFF',
  '#FF7A00',
  '#C0504D',
  '#4F81BD',
  '#9BBB59',
  '#8064A2',
  '#F79646',
]

const WIDTHS = [
  ['Hairline', 9525],
  ['Thin', 12700],
  ['Medium', 25400],
  ['Thick', 57150],
] as const

export function PropertiesPanel() {
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)
  const selection = useDeckStore((state) => state.selection)
  const edit = useDeckStore((state) => state.edit)

  if (open === null || slide === null) return <p className="text-xs text-muted">No presentation</p>
  if (selection.length === 0) return <SlideProperties />

  const shapes = slide.shapes.filter((shape) => selection.includes(shape.id))
  const first = shapes[0]

  const themes = open.themes
  const base = colorContextFor(open.deck, themes, slide)
  const master = [...open.deck.masters.values()][0]
  const theme = master?.theme == null ? undefined : themes.get(master.theme)

  /** The fill as drawn, so the panel shows the colour on screen. */
  const shown = (() => {
    if (first === undefined) return null
    const look = shapeLook(first, theme)
    if (look.fill?.kind !== 'solid' || look.fill.color === null) return null
    return resolveColor(look.fill.color, lookContext(base, look))?.hex ?? null
  })()

  const apply = (change: (shape: (typeof shapes)[number]) => boolean) => {
    edit((edited) =>
      edited.shapes
        .filter((shape) => selection.includes(shape.id))
        .map(change)
        .reduce((changed: boolean, one) => changed || one, false),
    )
  }

  return (
    <div className="space-y-4 text-xs">
      <p className="text-muted">
        {selection.length === 1 ? (first?.name ?? 'Shape') : `${String(selection.length)} shapes`}
      </p>

      <section aria-label="Fill" className="space-y-2">
        <h2 className="uppercase tracking-wide text-muted">Fill</h2>
        <div className="flex flex-wrap gap-1">
          {SWATCHES.map((hex) => (
            <button
              key={hex}
              type="button"
              aria-label={`Fill ${hex}`}
              aria-pressed={shown === hex}
              onClick={() => {
                apply((shape) =>
                  writeFill(shape, {
                    kind: 'solid',
                    color: { source: { kind: 'srgb', hex }, transforms: [] },
                  }),
                )
              }}
              style={{ background: hex }}
              className={`h-5 w-5 rounded border ${
                shown === hex ? 'border-accent' : 'border-border'
              }`}
            />
          ))}
          <button
            type="button"
            aria-label="No fill"
            onClick={() => {
              apply((shape) => writeFill(shape, { kind: 'none' }))
            }}
            className="h-5 rounded border border-border px-1.5 text-muted"
          >
            None
          </button>
        </div>
      </section>

      <BoxProperties shapes={shapes} />

      <TextProperties />

      <section aria-label="Line" className="space-y-2">
        <h2 className="uppercase tracking-wide text-muted">Line</h2>
        <div className="flex flex-wrap gap-1">
          {WIDTHS.map(([label, width]) => (
            <button
              key={label}
              type="button"
              aria-label={`Line ${label.toLowerCase()}`}
              onClick={() => {
                apply((shape) => writeLine(shape, { width }))
              }}
              className="rounded border border-border px-1.5 py-0.5 text-muted"
            >
              {label}
            </button>
          ))}
          <button
            type="button"
            aria-label="No line"
            onClick={() => {
              apply((shape) => writeLine(shape, { fill: { kind: 'none' } }))
            }}
            className="rounded border border-border px-1.5 py-0.5 text-muted"
          >
            None
          </button>
        </div>
      </section>
    </div>
  )
}
