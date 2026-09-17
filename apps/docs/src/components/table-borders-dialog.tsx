import { useState } from 'react'
import { BORDER_STYLES } from '../ooxml/table-borders'
import type { Border } from '../ooxml/table-borders'
import { normalizeHex } from '@orangery/ui-kit'
import { PickerPopover } from '@orangery/ui-kit'

/** Widths Word offers in its own borders dialog, in points. */
const WIDTHS = [0.25, 0.5, 1, 1.5, 2.25, 3, 4.5, 6]

/**
 * Table borders. One setting applied to every edge, which is what the toolbar
 * button in Word and Docs does; per-edge control belongs in a properties dialog
 * that does not exist yet.
 */
export function TableBordersDialog({
  current,
  onApply,
  onClose,
}: {
  current: Border | null
  onApply: (border: Border) => void
  onClose: () => void
}) {
  const [style, setStyle] = useState<string>(current?.style ?? 'single')
  const [width, setWidth] = useState(current?.width ?? 0.5)
  const [color, setColor] = useState(current?.color ?? '#000000')

  const normalized = normalizeHex(color)

  return (
    <PickerPopover title="Table borders" onClose={onClose}>
      <form
        className="flex w-72 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          onApply({ style, width, color: style === 'none' ? null : normalized })
          onClose()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Style</span>
          <select
            value={style}
            onChange={(event) => {
              setStyle(event.target.value)
            }}
            className="rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
          >
            {BORDER_STYLES.map((entry) => (
              <option key={entry.value} value={entry.value}>
                {entry.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Width (pt)</span>
          <select
            value={String(width)}
            onChange={(event) => {
              setWidth(Number.parseFloat(event.target.value))
            }}
            disabled={style === 'none'}
            className="rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none disabled:opacity-40"
          >
            {WIDTHS.map((value) => (
              <option key={value} value={String(value)}>
                {value}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Colour</span>
          <div className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-6 w-6 shrink-0 rounded border border-border"
              style={{ backgroundColor: normalized ?? '#000000' }}
            />
            <input
              value={color}
              onChange={(event) => {
                setColor(event.target.value)
              }}
              spellCheck={false}
              disabled={style === 'none'}
              className="w-28 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none disabled:opacity-40"
            />
          </div>
        </label>

        {color.trim() !== '' && normalized === null && (
          <p className="text-xs text-danger">Enter a colour like #333333.</p>
        )}

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1 text-sm text-text"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={style !== 'none' && normalized === null}
            className="rounded bg-accent px-3 py-1 text-sm text-black disabled:opacity-40"
          >
            Apply
          </button>
        </div>
      </form>
    </PickerPopover>
  )
}
