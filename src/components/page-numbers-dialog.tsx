import { useState } from 'react'
import type { PageNumberFormat, SectionProperties } from '../ooxml/section'
import { PickerPopover } from './picker-popover'

/**
 * Page numbering: which numerals, what to start at, and whether the first page
 * takes part.
 *
 * Where the number is printed is not here — that is which of the header and the
 * footer holds the `{page}` token, and it is set by typing it there.
 */

const FORMATS: readonly { value: PageNumberFormat; label: string }[] = [
  { value: 'decimal', label: '1, 2, 3' },
  { value: 'lowerRoman', label: 'i, ii, iii' },
  { value: 'upperRoman', label: 'I, II, III' },
  { value: 'lowerLetter', label: 'a, b, c' },
  { value: 'upperLetter', label: 'A, B, C' },
]

export function PageNumbersDialog({
  section,
  onApply,
  onClose,
}: {
  section: SectionProperties
  onApply: (section: SectionProperties) => void
  onClose: () => void
}) {
  const [draft, setDraft] = useState(section)
  const numbering = draft.pageNumbering

  const update = (patch: { format?: PageNumberFormat; start?: number | null }) => {
    setDraft({
      ...draft,
      pageNumbering: {
        format: patch.format ?? numbering?.format ?? 'decimal',
        start: patch.start === undefined ? (numbering?.start ?? null) : patch.start,
      },
    })
  }

  return (
    <PickerPopover title="Page numbers" onClose={onClose}>
      <form
        className="flex w-72 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          onApply(draft)
          onClose()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Number format</span>
          <select
            value={numbering?.format ?? 'decimal'}
            onChange={(event) => {
              update({ format: event.target.value as PageNumberFormat })
            }}
            className="rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
          >
            {FORMATS.map((format) => (
              <option key={format.value} value={format.value}>
                {format.label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={numbering?.start !== null && numbering?.start !== undefined}
            onChange={(event) => {
              // Cleared means the section carries on from the one before it,
              // which is not the same as starting at one.
              update({ start: event.target.checked ? 1 : null })
            }}
            className="accent-accent"
          />
          Start at
          <input
            type="number"
            min={0}
            value={numbering?.start ?? ''}
            disabled={numbering?.start === null || numbering?.start === undefined}
            onChange={(event) => {
              const value = Number.parseInt(event.target.value, 10)
              if (Number.isFinite(value)) update({ start: Math.max(0, value) })
            }}
            className="w-16 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none disabled:opacity-40"
          />
        </label>

        <label className="flex items-center gap-2 text-sm text-text">
          <input
            type="checkbox"
            checked={draft.differentFirstPage}
            onChange={(event) => {
              setDraft({ ...draft, differentFirstPage: event.target.checked })
            }}
            className="accent-accent"
          />
          Leave the first page without a header or footer
        </label>

        <div className="flex justify-end gap-2 pt-1">
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
