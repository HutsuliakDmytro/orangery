import { useState } from 'react'
import { formatValue } from '@orangery/numfmt'

/**
 * Format Cells: the number half of it.
 *
 * A format code is a small language, and nobody remembers it. What makes the
 * dialog usable is not the list of categories but the line under the box: the
 * value the cursor is on, shown as the code would show it, changing as the
 * code is typed. Somebody who has never seen `0.00_);[Red](0.00)` can still
 * see that it puts negatives in red brackets.
 *
 * Only the number format. The rest of what Excel's Format Cells holds —
 * fonts, borders, fills, alignment — is already on the toolbar, and a dialog
 * that offered the same things a second way would be two places to change one
 * thing.
 */

export interface FormatDialogProps {
  /** The code the cell already shows, which is where the box starts. */
  code: string
  /** What the cell holds, for the example; null where it holds nothing. */
  value: number | null
  date1904: boolean
  onApply: (code: string) => void
  onCancel: () => void
}

/** The codes worth offering by name, in the order a person meets them. */
const CATEGORIES: { label: string; code: string }[] = [
  { label: 'Automatic', code: 'General' },
  { label: 'Number', code: '#,##0.00' },
  { label: 'Number, thousands', code: '#,##0' },
  { label: 'Negatives in red', code: '#,##0.00;[Red]-#,##0.00' },
  { label: 'Accounting', code: '_(* #,##0.00_);_(* (#,##0.00);_(* "-"??_);_(@_)' },
  { label: 'Percent', code: '0.00%' },
  { label: 'Scientific', code: '0.00E+00' },
  { label: 'Fraction', code: '# ??/??' },
  { label: 'Date', code: 'yyyy-mm-dd' },
  { label: 'Date and time', code: 'yyyy-mm-dd hh:mm' },
  { label: 'Time', code: 'h:mm:ss' },
  { label: 'Elapsed time', code: '[h]:mm:ss' },
  { label: 'Text', code: '@' },
]

export function FormatDialog({ code, value, date1904, onApply, onCancel }: FormatDialogProps) {
  const [written, setWritten] = useState(code)

  /**
   * The example, which is the whole point of the dialog.
   *
   * A code that means nothing formats to nothing rather than failing — the
   * formatter has no notion of an invalid code, and neither does Excel — so
   * an empty result is said in words. It is the same answer for a code that
   * is wrong and for one that deliberately shows nothing, because from here
   * those two are the same thing: the cell will look empty.
   */
  const shown =
    written.trim() === '' ? '' : formatValue(value ?? 1234.5, written, { date1904 }).text
  const example = shown === '' ? 'Shows nothing' : shown

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Format cells"
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
    >
      <div className="flex w-[34rem] flex-col gap-3 rounded border border-border bg-bg p-4 text-xs">
        <h2 className="text-sm">Number format</h2>

        <div className="flex gap-3">
          <select
            aria-label="Category"
            size={8}
            value={CATEGORIES.find((one) => one.code === written)?.label ?? ''}
            className="w-52 rounded border border-border bg-surface p-1 outline-none focus:border-accent"
            onChange={(event) => {
              const picked = CATEGORIES.find((one) => one.label === event.target.value)
              if (picked !== undefined) setWritten(picked.code)
            }}
          >
            {CATEGORIES.map((one) => (
              <option key={one.label} value={one.label}>
                {one.label}
              </option>
            ))}
          </select>

          <div className="flex flex-1 flex-col gap-2">
            <label className="flex flex-col gap-1">
              <span className="text-muted">Format code</span>
              <input
                type="text"
                aria-label="Format code"
                value={written}
                className="h-7 rounded border border-border bg-surface px-2 font-mono outline-none focus:border-accent"
                onChange={(event) => {
                  setWritten(event.target.value)
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && written.trim() !== '') onApply(written)
                  if (event.key === 'Escape') onCancel()
                }}
              />
            </label>

            <div className="rounded border border-border bg-surface px-2 py-1">
              <span className="text-muted">Example </span>
              <span aria-label="Example">{example}</span>
            </div>

            <p className="text-muted">
              Four parts, separated by semicolons: positive, negative, zero, text.
            </p>
          </div>
        </div>

        <div className="flex justify-end gap-3">
          <button type="button" className="text-muted hover:text-text" onClick={onCancel}>
            Cancel
          </button>
          <button
            type="button"
            className="text-accent"
            onClick={() => {
              if (written.trim() !== '') onApply(written)
            }}
          >
            Apply
          </button>
        </div>
      </div>
    </div>
  )
}
