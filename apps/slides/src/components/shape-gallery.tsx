import { PickerPopover } from '@orangery/ui-kit'
import { pathFor } from '../render/geometry'
import { SHAPE_GROUPS } from '../render/shape-presets'
import { useViewStore } from '../store/view-store'

/**
 * The gallery of shapes, as a popover.
 *
 * Choosing one arms it; the drag that follows on the slide says where and how
 * big. The thumbnails are the real geometry rather than icons, so what is
 * chosen is what appears.
 */

const THUMBNAIL = { width: 28, height: 22 }

export function ShapeGallery() {
  const armed = useViewStore((state) => state.drawing)
  const setDrawing = useViewStore((state) => state.setDrawing)
  const showing = useViewStore((state) => state.choosingShape)
  const setShowing = useViewStore((state) => state.setChoosingShape)

  if (!showing) return null

  return (
    <PickerPopover
      title="Shapes"
      onClose={() => {
        setShowing(false)
      }}
    >
      <div className="flex w-[min(360px,80vw)] flex-col gap-3">
        {SHAPE_GROUPS.map((group) => (
          <div key={group.name}>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">
              {group.name}
            </h3>
            <div className="flex flex-wrap gap-1">
              {group.presets.map(([preset, label]) => (
                <button
                  key={preset}
                  type="button"
                  title={label}
                  aria-label={label}
                  aria-pressed={armed === preset}
                  onClick={() => {
                    setDrawing(preset)
                    setShowing(false)
                  }}
                  className={`rounded border p-1 ${
                    armed === preset ? 'border-accent' : 'border-border'
                  }`}
                >
                  <svg
                    width={THUMBNAIL.width}
                    height={THUMBNAIL.height}
                    viewBox={`0 0 ${String(THUMBNAIL.width)} ${String(THUMBNAIL.height)}`}
                    aria-hidden
                  >
                    <path
                      d={pathFor(preset, THUMBNAIL)}
                      fill={preset === 'line' ? 'none' : 'var(--accent)'}
                      fillOpacity={0.5}
                      stroke="var(--accent)"
                      strokeWidth={1}
                    />
                  </svg>
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </PickerPopover>
  )
}
