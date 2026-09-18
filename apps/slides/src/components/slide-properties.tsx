import { layoutOf, masterOf, setSlideLayout, slideName } from '@orangery/ooxml-presentation'
import { currentSlide, useDeckStore } from '../store/deck-store'

/**
 * What the slide itself looks like, shown when no shape is selected.
 *
 * The layout picker offers every layout of the slide's master, in the order the
 * master lists them — PowerPoint's gallery order. Changing layout moves only the
 * relationship: a placeholder names what it is and resolves against whichever
 * layout the slide points at, so the text stays and takes the new geometry.
 */
export function SlideProperties() {
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)
  const editPackage = useDeckStore((state) => state.editPackage)

  if (open === null || slide === null) return <p className="text-xs text-muted">No presentation</p>

  const current = layoutOf(open.deck, slide)
  const master = current === null ? null : masterOf(open.deck, current)

  const layouts = (master?.layouts ?? [])
    .map((path) => open.deck.layouts.get(path))
    .filter((layout) => layout !== undefined)

  return (
    <div className="space-y-3">
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

      <p className="text-xs text-muted">Nothing selected</p>
    </div>
  )
}
