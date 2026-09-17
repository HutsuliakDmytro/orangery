import { useState } from 'react'
import {
  DEFAULT_COLUMN_SPACING,
  PAGE_SIZES,
  pageSizeIdFor,
  withOrientation,
  withPageSize,
} from '../ooxml/section'
import type { PageSizeId, SectionProperties } from '../ooxml/section'
import { PickerPopover } from '@orangery/ui-kit'

/**
 * Page setup. Changing any of this changes the document, so the caller marks it
 * dirty — unlike zoom, which is a view setting.
 */
export function PageSetupDialog({
  section,
  onApply,
  onClose,
}: {
  section: SectionProperties
  onApply: (section: SectionProperties) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(section)
  const sizeId = pageSizeIdFor(draft.width, draft.height)

  const setMargin = (key: keyof SectionProperties['margins'], value: string) => {
    const points = Number.parseFloat(value) * 72
    if (!Number.isFinite(points)) return
    setDraft({ ...draft, margins: { ...draft.margins, [key]: Math.max(0, points) } })
  }

  return (
    <PickerPopover title="Page setup" onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          onApply(draft)
          onClose()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Paper size</span>
          <select
            value={sizeId ?? 'custom'}
            onChange={(event) => {
              if (event.target.value === 'custom') return
              setDraft(withPageSize(draft, event.target.value as PageSizeId))
            }}
            className="rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
          >
            {sizeId === null && <option value="custom">Custom</option>}
            {PAGE_SIZES.map((size) => (
              <option key={size.id} value={size.id}>
                {size.label}
              </option>
            ))}
          </select>
        </label>

        <fieldset className="flex gap-3">
          <legend className="mb-1 text-xs text-muted">Orientation</legend>
          {(['portrait', 'landscape'] as const).map((orientation) => (
            <label key={orientation} className="flex items-center gap-1 text-sm text-text">
              <input
                type="radio"
                name="orientation"
                checked={draft.orientation === orientation}
                onChange={() => {
                  setDraft(withOrientation(draft, orientation))
                }}
                className="accent-accent"
              />
              {orientation === 'portrait' ? 'Portrait' : 'Landscape'}
            </label>
          ))}
        </fieldset>

        <label className="flex items-center gap-2 text-sm text-text">
          <span className="w-20 shrink-0 text-muted">Columns</span>
          <select
            value={String(draft.columns?.count ?? 1)}
            onChange={(event) => {
              const count = Number.parseInt(event.target.value, 10)
              setDraft({
                ...draft,
                // One column is what a section with nothing to say means, so it
                // is written as nothing rather than as a count of one.
                columns:
                  count <= 1
                    ? null
                    : {
                        count,
                        spacing: draft.columns?.spacing ?? DEFAULT_COLUMN_SPACING,
                        separator: draft.columns?.separator ?? false,
                        original: draft.columns?.original ?? null,
                      },
              })
            }}
            className="rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
          >
            {[1, 2, 3].map((count) => (
              <option key={count} value={String(count)}>
                {count}
              </option>
            ))}
          </select>

          {draft.columns !== null && (
            <label className="flex items-center gap-1 text-xs text-muted">
              <input
                type="checkbox"
                checked={draft.columns.separator}
                onChange={(event) => {
                  const columns = draft.columns
                  if (columns === null) return
                  setDraft({ ...draft, columns: { ...columns, separator: event.target.checked } })
                }}
                className="accent-accent"
              />
              Rule between
            </label>
          )}
        </label>

        <fieldset className="grid grid-cols-2 gap-2">
          <legend className="mb-1 text-xs text-muted">Margins (inches)</legend>
          {(['top', 'bottom', 'left', 'right'] as const).map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm text-text">
              <span className="w-14 capitalize text-muted">{key}</span>
              <input
                value={(draft.margins[key] / 72).toFixed(2)}
                onChange={(event) => {
                  setMargin(key, event.target.value)
                }}
                inputMode="decimal"
                className="w-16 rounded border border-border bg-surface-2 px-2 py-1 text-sm outline-none"
              />
            </label>
          ))}
        </fieldset>

        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-border px-3 py-1 text-sm text-text"
          >
            Cancel
          </button>
          <button type="submit" className="rounded bg-accent px-3 py-1 text-sm text-black">
            Apply
          </button>
        </div>
      </form>
    </PickerPopover>
  )
}
