import {
  layoutOf,
  masterOf,
  masterShapesShown,
  readBackground,
  setSlideLayout,
  showMasterShapes,
  slideName,
  writeBackground,
} from '@orangery/ooxml-presentation'
import type { Fill } from '@orangery/ooxml-drawingml'
import { setSlideSize, SLIDE_SIZE_PRESETS } from '@orangery/ooxml-presentation'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * What the slide itself looks like, shown when no shape is selected.
 *
 * The layout picker offers every layout of the slide's master, in the order the
 * master lists them — PowerPoint's gallery order. Changing layout moves only the
 * relationship: a placeholder names what it is and resolves against whichever
 * layout the slide points at, so the text stays and takes the new geometry.
 *
 * The background is the slide's own, not the one it is drawn with. "From
 * layout" is the absence of `p:bg` and is a different thing from a background
 * of none, which stops the inheritance and leaves the slide transparent — the
 * picker says both because the file does.
 */

const solid = (hex: string): Fill => ({
  kind: 'solid',
  color: { source: { kind: 'srgb', hex }, transforms: [] },
})

const gradient = (from: string, to: string, angle: number): Fill => ({
  kind: 'gradient',
  stops: [
    { position: 0, color: { source: { kind: 'srgb', hex: from }, transforms: [] } },
    { position: 1, color: { source: { kind: 'srgb', hex: to }, transforms: [] } },
  ],
  angle,
  radial: false,
})

/** `a:lin` is 60000ths of a degree; the panel speaks in degrees. */
const DEGREE = 60000

type Kind = 'inherit' | 'solid' | 'gradient' | 'picture' | 'pattern' | 'none'

const hexOf = (fill: Fill | null, at = 0): string => {
  if (fill?.kind === 'solid') return fill.color?.source.kind === 'srgb' ? fill.color.source.hex : ''
  if (fill?.kind !== 'gradient') return ''

  const source = fill.stops[at]?.color?.source
  return source?.kind === 'srgb' ? source.hex : ''
}

/** EMU per centimetre, for the one place a person types a measurement. */
const EMU_PER_CM = 360000

const cm = (emu: number) => Math.round((emu / EMU_PER_CM) * 10) / 10

export function SlideProperties() {
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)
  const edit = useDeckStore((state) => state.edit)
  const editPackage = useDeckStore((state) => state.editPackage)
  const contentFit = useViewStore((state) => state.contentFit)
  const setContentFit = useViewStore((state) => state.setContentFit)

  if (open === null || slide === null) return <p className="text-xs text-muted">No presentation</p>

  const current = layoutOf(open.deck, slide)
  const master = current === null ? null : masterOf(open.deck, current)

  const layouts = (master?.layouts ?? [])
    .map((path) => open.deck.layouts.get(path))
    .filter((layout) => layout !== undefined)

  const own = readBackground(slide, undefined)
  const fill = own?.fill ?? null
  const kind: Kind = fill === null ? 'inherit' : fill.kind === 'group' ? 'inherit' : fill.kind
  const shown = masterShapesShown(slide)

  const size = open.deck.slideSize
  const custom = !SLIDE_SIZE_PRESETS.some(
    (preset) => preset.width === size.width && preset.height === size.height,
  )

  const resizeDeck = (next: { width: number; height: number }) => {
    editPackage((deck) => setSlideSize(deck.package, deck.deck, next, contentFit))
  }

  const paint = (next: Fill | null) => {
    edit((one) => writeBackground(one, next))
  }

  const setKind = (next: Kind) => {
    if (next === 'inherit') paint(null)
    else if (next === 'none') paint({ kind: 'none' })
    else if (next === 'solid') paint(solid(hexOf(fill) === '' ? '#FFFFFF' : hexOf(fill)))
    else if (next === 'gradient') {
      const start = hexOf(fill) === '' ? '#FF7A00' : hexOf(fill)
      paint(gradient(start, '#000000', 90 * DEGREE))
    }
  }

  const angle = fill?.kind === 'gradient' ? Math.round((fill.angle ?? 0) / DEGREE) : 0

  return (
    <div className="space-y-4">
      <div>
        <label htmlFor="slide-layout" className="mb-1 block text-xs text-muted">
          Layout
        </label>
        <select
          id="slide-layout"
          value={current?.path ?? ''}
          disabled={layouts.length === 0}
          onChange={(event) => {
            const chosen = open.deck.layouts.get(event.target.value)
            if (chosen === undefined) return

            editPackage((deck) => {
              const here = deck.deck.slides[useDeckStore.getState().current]
              return here !== undefined && setSlideLayout(deck.package, here, chosen)
            })
          }}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text"
        >
          {layouts.map((layout) => (
            <option key={layout.path} value={layout.path}>
              {slideName(layout)}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <label htmlFor="slide-size" className="block text-xs text-muted">
          Slide size
        </label>
        <select
          id="slide-size"
          value={`${String(size.width)}x${String(size.height)}`}
          onChange={(event) => {
            const [width, height] = event.target.value.split('x').map(Number)
            if (width === undefined || height === undefined) return

            resizeDeck({ width, height })
          }}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text"
        >
          {SLIDE_SIZE_PRESETS.map((preset) => (
            <option key={preset.label} value={`${String(preset.width)}x${String(preset.height)}`}>
              {preset.label}
            </option>
          ))}
          {custom && (
            <option value={`${String(size.width)}x${String(size.height)}`}>
              Custom ({String(cm(size.width))} × {String(cm(size.height))} cm)
            </option>
          )}
        </select>

        <div className="flex items-center gap-2">
          <input
            type="number"
            aria-label="Slide width in centimetres"
            value={cm(size.width)}
            step={0.1}
            min={1}
            onChange={(event) => {
              resizeDeck({ width: Number(event.target.value) * EMU_PER_CM, height: size.height })
            }}
            className="w-16 rounded border border-border bg-surface px-1 py-0.5 text-xs text-text"
          />
          <input
            type="number"
            aria-label="Slide height in centimetres"
            value={cm(size.height)}
            step={0.1}
            min={1}
            onChange={(event) => {
              resizeDeck({ width: size.width, height: Number(event.target.value) * EMU_PER_CM })
            }}
            className="w-16 rounded border border-border bg-surface px-1 py-0.5 text-xs text-text"
          />
          <select
            aria-label="What happens to the content"
            value={contentFit}
            onChange={(event) => {
              setContentFit(event.target.value === 'maximize' ? 'maximize' : 'fit')
            }}
            className="min-w-0 flex-1 rounded border border-border bg-surface px-1 py-0.5 text-xs text-text"
          >
            <option value="fit">Ensure fit</option>
            <option value="maximize">Maximize</option>
          </select>
        </div>
      </div>

      <div className="space-y-2">
        <label htmlFor="slide-background" className="block text-xs text-muted">
          Background
        </label>
        <select
          id="slide-background"
          value={kind}
          onChange={(event) => {
            setKind(event.target.value as Kind)
          }}
          className="w-full rounded border border-border bg-surface px-2 py-1 text-xs text-text"
        >
          <option value="inherit">From layout</option>
          <option value="solid">Solid colour</option>
          <option value="gradient">Gradient</option>
          <option value="none">None</option>
          {/* What the file already has, so the picker can show it without
              offering it: a picture is chosen from disk and a pattern is not
              offered at all. */}
          {kind === 'picture' && <option value="picture">Picture</option>}
          {kind === 'pattern' && <option value="pattern">Pattern</option>}
        </select>

        {kind === 'solid' && (
          <input
            type="color"
            aria-label="Background colour"
            value={hexOf(fill) === '' ? '#FFFFFF' : hexOf(fill)}
            onChange={(event) => {
              paint(solid(event.target.value.toUpperCase()))
            }}
            className="h-7 w-full rounded border border-border bg-surface"
          />
        )}

        {kind === 'gradient' && (
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label="Gradient start"
              value={hexOf(fill, 0) === '' ? '#FF7A00' : hexOf(fill, 0)}
              onChange={(event) => {
                paint(gradient(event.target.value.toUpperCase(), hexOf(fill, 1), angle * DEGREE))
              }}
              className="h-7 min-w-0 flex-1 rounded border border-border bg-surface"
            />
            <input
              type="color"
              aria-label="Gradient end"
              value={hexOf(fill, 1) === '' ? '#000000' : hexOf(fill, 1)}
              onChange={(event) => {
                paint(gradient(hexOf(fill, 0), event.target.value.toUpperCase(), angle * DEGREE))
              }}
              className="h-7 min-w-0 flex-1 rounded border border-border bg-surface"
            />
            <input
              type="number"
              aria-label="Gradient angle"
              value={angle}
              min={0}
              max={359}
              onChange={(event) => {
                paint(gradient(hexOf(fill, 0), hexOf(fill, 1), Number(event.target.value) * DEGREE))
              }}
              className="w-14 rounded border border-border bg-surface px-1 py-0.5 text-xs text-text"
            />
          </div>
        )}

        <label className="flex items-center gap-2 text-xs text-text">
          <input
            type="checkbox"
            checked={!shown}
            onChange={(event) => {
              edit((one) => showMasterShapes(one, !event.target.checked))
            }}
          />
          Hide background graphics
        </label>
      </div>
    </div>
  )
}
