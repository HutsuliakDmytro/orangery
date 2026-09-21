import { ENCODINGS } from '../document/csv'
import type { Encoding } from '../document/csv'
import { previewRows } from '../document/csv-file'
import type { ImportOptions } from '../document/csv-file'

/**
 * The questions a `.csv` cannot answer for itself.
 *
 * Every one of them is guessed first and shown as a guess: the separator from
 * the shape of the lines, the decimal point from the separator. What makes it
 * a wizard rather than a dialog of settings is the table underneath — a person
 * cannot be expected to know their file is Windows-1251, but they can see at a
 * glance that the words have gone wrong.
 */

export interface CsvWizardProps {
  bytes: Uint8Array
  name: string
  options: ImportOptions
  onChange: (options: ImportOptions) => void
  onImport: () => void
  onCancel: () => void
}

const DELIMITERS: { label: string; value: string }[] = [
  { label: 'Comma', value: ',' },
  { label: 'Semicolon', value: ';' },
  { label: 'Tab', value: '\t' },
  { label: 'Pipe', value: '|' },
]

const ENCODING_NAMES: Readonly<Record<Encoding, string>> = {
  'utf-8': 'Unicode (UTF-8)',
  'windows-1251': 'Cyrillic (Windows-1251)',
  'windows-1252': 'Western (Windows-1252)',
}

export function CsvWizard({ bytes, name, options, onChange, onImport, onCancel }: CsvWizardProps) {
  const preview = previewRows(bytes, options)

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Import text file"
      className="absolute inset-0 z-20 flex items-center justify-center bg-black/40"
    >
      <div className="flex max-h-[80%] w-[40rem] flex-col gap-3 rounded border border-border bg-bg p-4 text-xs">
        <h2 className="text-sm">{`Import ${name}`}</h2>

        <div className="flex flex-wrap items-center gap-3">
          <Choice
            label="Separator"
            value={options.delimiter}
            options={DELIMITERS}
            onPick={(value) => {
              onChange({ ...options, delimiter: value })
            }}
          />
          <Choice
            label="Encoding"
            value={options.encoding}
            options={ENCODINGS.map((one) => ({ label: ENCODING_NAMES[one], value: one }))}
            onPick={(value) => {
              onChange({ ...options, encoding: value as Encoding })
            }}
          />
          <Choice
            label="Decimal"
            value={options.decimal}
            options={[
              { label: 'Point', value: '.' },
              { label: 'Comma', value: ',' },
            ]}
            onPick={(value) => {
              onChange({ ...options, decimal: value === ',' ? ',' : '.' })
            }}
          />

          <label className="flex items-center gap-1">
            <input
              type="checkbox"
              aria-label="First row is a header"
              checked={options.header}
              onChange={() => {
                onChange({ ...options, header: !options.header })
              }}
            />
            <span className="text-muted">First row is a header</span>
          </label>
        </div>

        {/* The answer to every question above, in the one form that needs no
            explaining: the file, as it would arrive. */}
        <div className="min-h-0 flex-1 overflow-auto rounded border border-border">
          <table className="w-full border-collapse">
            <tbody>
              {preview.map((row, index) => (
                <tr key={`row-${String(index)}`}>
                  {row.map((field, column) => (
                    <td
                      key={`cell-${String(column)}`}
                      className={`max-w-40 truncate border border-border px-1 py-0.5 ${
                        options.header && index === 0 ? 'font-bold' : ''
                      }`}
                    >
                      {field}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="text-muted">{`${String(preview.length)} rows shown.`}</p>

        <div className="flex justify-end gap-3">
          <button type="button" className="text-muted hover:text-text" onClick={onCancel}>
            Cancel
          </button>
          <button type="button" className="text-accent" onClick={onImport}>
            Import
          </button>
        </div>
      </div>
    </div>
  )
}

/** A labelled dropdown, which is what every question here turns out to be. */
function Choice({
  label,
  value,
  options,
  onPick,
}: {
  label: string
  value: string
  options: readonly { label: string; value: string }[]
  onPick: (value: string) => void
}) {
  return (
    <label className="flex items-center gap-1">
      <span className="text-muted">{label}</span>
      <select
        aria-label={label}
        value={value}
        className="h-6 rounded border border-border bg-surface px-1 outline-none focus:border-accent"
        onChange={(event) => {
          onPick(event.target.value)
        }}
      >
        {options.map((one) => (
          <option key={one.label} value={one.value}>
            {one.label}
          </option>
        ))}
      </select>
    </label>
  )
}
