import { slideName } from '@orangery/ooxml-presentation'
import { SlideView } from '../render/slide-view'
import { useDeckStore } from '../store/deck-store'

/**
 * The masters of a deck and the layouts each of them offers.
 *
 * This is the filmstrip of the master view, and it draws its entries the same
 * way the filmstrip does — one renderer for everything, so a layout cannot look
 * different here from how it looks under a slide.
 *
 * Layouts sit under the master that lists them rather than in one flat list.
 * Which master a layout belongs to is not a detail: it decides what the layout
 * inherits, and a deck with two masters has two sets of layouts that only look
 * alike.
 */
export function MasterList() {
  const open = useDeckStore((state) => state.open)
  const master = useDeckStore((state) => state.master)
  const showMaster = useDeckStore((state) => state.showMaster)

  if (open === null) {
    return <p className="p-2 text-xs text-muted">No presentation open</p>
  }

  const entry = (path: string, label: string, indented: boolean) => {
    const part = open.deck.layouts.get(path) ?? open.deck.masters.get(path)
    if (part === undefined) return null

    return (
      <li key={path} className={indented ? 'pl-4' : ''}>
        <button
          type="button"
          aria-label={label}
          aria-current={path === master}
          onClick={() => {
            showMaster(path)
          }}
          className={`flex w-full items-start gap-2 rounded border p-1 text-left ${
            path === master ? 'border-accent' : 'border-transparent'
          }`}
        >
          <SlideView
            deck={open.deck}
            slide={{ ...part, id: '', layout: null, notes: null }}
            themes={open.themes}
            package={open.package}
            className="min-w-0 flex-1 border border-border"
          />
        </button>
        <p className="truncate pl-1 text-[10px] text-muted">{slideName(part)}</p>
      </li>
    )
  }

  return (
    <ol className="flex flex-col gap-2 p-2">
      {[...open.deck.masters.values()].flatMap((one) => [
        entry(one.path, `Master ${slideName(one)}`, false),
        ...one.layouts.map((path) => {
          const layout = open.deck.layouts.get(path)
          return layout === undefined ? null : entry(path, `Layout ${slideName(layout)}`, true)
        }),
      ])}
    </ol>
  )
}
