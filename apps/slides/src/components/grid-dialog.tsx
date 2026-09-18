import { PickerPopover } from '@orangery/ui-kit'
import { readGridSpacing, writeGridSpacing } from '@orangery/ooxml-presentation'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * Grid and Guides, where PowerPoint keeps the same four answers.
 *
 * Three of them belong to the window and one to the file: the spacing is
 * written into `viewProps.xml` beside the guides, because a grid you have to
 * set again every morning is not doing its job, while whether it is drawn and
 * whether things land on it are this session's business.
 */

/** The spacings PowerPoint offers, as fractions of an inch. */
const SPACINGS: readonly { label: string; emu: number }[] = [
  { label: '1/24"', emu: 38100 },
  { label: '1/12"', emu: 76200 },
  { label: '1/8"', emu: 114300 },
  { label: '1/6"', emu: 152400 },
  { label: '1/4"', emu: 228600 },
  { label: '1/2"', emu: 457200 },
  { label: '1"', emu: 914400 },
]

export function GridDialog() {
  const showing = useViewStore((state) => state.editingGrid)
  const setShowing = useViewStore((state) => state.setEditingGrid)
  const grid = useViewStore((state) => state.grid)
  const setGrid = useViewStore((state) => state.setGrid)
  const snapToGrid = useViewStore((state) => state.snapToGrid)
  const setSnapToGrid = useViewStore((state) => state.setSnapToGrid)
  const rulers = useViewStore((state) => state.rulers)
  const setRulers = useViewStore((state) => state.setRulers)

  const open = useDeckStore((state) => state.open)
  const editPackage = useDeckStore((state) => state.editPackage)

  if (!showing || open === null) return null
  const spacing = readGridSpacing(open.package)

  return (
    <PickerPopover
      title="Grid and Guides"
      onClose={() => {
        setShowing(false)
      }}
    >
      <div className="w-64 space-y-3 text-xs text-text">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={snapToGrid}
            onChange={(event) => {
              setSnapToGrid(event.target.checked)
            }}
          />
          Snap objects to grid
        </label>

        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={grid}
            onChange={(event) => {
              setGrid(event.target.checked)
            }}
          />
          Display grid on screen
        </label>

        <label className="flex items-center justify-between gap-2 pl-6">
          Spacing
          <select
            aria-label="Grid spacing"
            value={String(spacing)}
            onChange={(event) => {
              editPackage((deck) => writeGridSpacing(deck.package, Number(event.target.value)))
            }}
            className="rounded border border-border bg-transparent px-2 py-1 outline-none focus:border-accent"
          >
            {/* A deck that states something we do not offer keeps it: the file
                is allowed any spacing, and the list is a set of good answers
                rather than the only legal ones. */}
            {SPACINGS.every((one) => one.emu !== spacing) && (
              <option value={String(spacing)}>{`${(spacing / 914400).toFixed(3)}"`}</option>
            )}
            {SPACINGS.map((one) => (
              <option key={one.emu} value={String(one.emu)}>
                {one.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 border-t border-border pt-3">
          <input
            type="checkbox"
            checked={rulers}
            onChange={(event) => {
              setRulers(event.target.checked)
            }}
          />
          Display drawing guides on screen
        </label>

        <div className="flex justify-end pt-1">
          <button
            type="button"
            onClick={() => {
              setShowing(false)
            }}
            className="rounded bg-accent px-3 py-1 text-black hover:bg-accent-hover"
          >
            Done
          </button>
        </div>
      </div>
    </PickerPopover>
  )
}
