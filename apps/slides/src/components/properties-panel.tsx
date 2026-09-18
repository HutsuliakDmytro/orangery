import { writeFill, writeLine, writeShadow } from '@orangery/ooxml-presentation'

/** Black at forty percent, which is what every program's default shadow is. */
const shadowBlack = (): Color => ({
  source: { kind: 'srgb', hex: '#000000' },
  transforms: [{ kind: 'alpha', value: 0.4 }],
})
import { resolveColor } from '@orangery/ooxml-drawingml'
import type { Color, Shadow } from '@orangery/ooxml-drawingml'
import { colorContextFor, lookContext, shapeLook } from '@orangery/ooxml-presentation'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { SlideProperties } from './slide-properties'
import { BoxProperties } from './box-properties'
import { PictureProperties } from './picture-properties'
import { ColorControl } from './color-control'
import { GradientEditor } from './gradient-editor'
import { TextProperties } from './text-properties'

/**
 * What the selection looks like, and how to change it.
 *
 * A colour can be picked from the theme or stated outright, and the difference
 * is the whole point: `accent1` means "whatever this deck calls accent 1" and
 * follows the theme, while a literal means that colour for ever. Both are
 * things a person wants; offering only the second, as this panel did, quietly
 * made every deck edited here stop following its own theme.
 */

/**
 * Three shadows and none, rather than a panel of numbers.
 *
 * Distance, angle and blur together are four decisions to make a box look
 * slightly raised, and nobody wants to make four. The angle is 45° down and to
 * the right in all of them, which is where light comes from in every deck
 * anybody has ever made.
 */
const SHADOWS: readonly (readonly [string, Shadow | null])[] = [
  ['None', null],
  ['Soft', { distance: 38100, direction: 45 * 60000, blur: 76200, color: shadowBlack() }],
  ['Medium', { distance: 76200, direction: 45 * 60000, blur: 114300, color: shadowBlack() }],
  ['Hard', { distance: 114300, direction: 45 * 60000, blur: 0, color: shadowBlack() }],
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

  /** The gradient in force, when the fill is one, so its stops can be edited. */
  const gradient = (() => {
    if (first === undefined) return null
    const look = shapeLook(first, theme)
    return look.fill?.kind === 'gradient' ? look.fill : null
  })()

  /** The same for the outline, which had no colour control at all before. */
  const lineColour = (() => {
    if (first === undefined) return null
    const look = shapeLook(first, theme)
    const fill = look.line?.fill
    if (fill?.kind !== 'solid' || fill.color === null) return null
    return resolveColor(fill.color, lookContext(base, look))?.hex ?? null
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
        <ColorControl
          label="Fill"
          selected={shown}
          onPick={(color) => {
            apply((shape) => writeFill(shape, { kind: 'solid', color }))
          }}
          onClear={() => {
            apply((shape) => writeFill(shape, { kind: 'none' }))
          }}
        />
        {gradient !== null && (
          <GradientEditor
            fill={gradient}
            context={base}
            onChange={(next) => {
              apply((shape) => writeFill(shape, next))
            }}
          />
        )}

        <button
          type="button"
          aria-label="Fill gradient"
          onClick={() => {
            // From the colour it already has to nothing, which is the gradient
            // people actually reach for; the stops can be moved afterwards
            // because they are ordinary stops in the file.
            const from = shown ?? '#FF7A00'
            apply((shape) =>
              writeFill(shape, {
                kind: 'gradient',
                radial: false,
                angle: 90 * 60000,
                stops: [
                  { position: 0, color: { source: { kind: 'srgb', hex: from }, transforms: [] } },
                  {
                    position: 1,
                    color: { source: { kind: 'srgb', hex: '#FFFFFF' }, transforms: [] },
                  },
                ],
              }),
            )
          }}
          className="rounded border border-border px-1.5 py-0.5 text-muted"
        >
          Gradient
        </button>
      </section>

      <PictureProperties />

      <BoxProperties shapes={shapes} />

      <TextProperties />

      <section aria-label="Shadow" className="space-y-2">
        <h2 className="uppercase tracking-wide text-muted">Shadow</h2>
        <div className="flex flex-wrap gap-1">
          {SHADOWS.map(([label, shadow]) => (
            <button
              key={label}
              type="button"
              aria-label={`Shadow ${label.toLowerCase()}`}
              aria-pressed={
                shadow === null
                  ? first?.properties?.shadow == null
                  : first?.properties?.shadow?.distance === shadow.distance
              }
              onClick={() => {
                apply((shape) => writeShadow(shape, shadow))
              }}
              className="rounded border border-border px-1.5 py-0.5 text-muted"
            >
              {label}
            </button>
          ))}
        </div>
      </section>

      <section aria-label="Line" className="space-y-2">
        <h2 className="uppercase tracking-wide text-muted">Line</h2>
        <ColorControl
          label="Line"
          selected={lineColour}
          onPick={(color) => {
            apply((shape) => writeLine(shape, { fill: { kind: 'solid', color } }))
          }}
          onClear={() => {
            apply((shape) => writeLine(shape, { fill: { kind: 'none' } }))
          }}
        />
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
