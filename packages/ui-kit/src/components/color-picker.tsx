import { useState } from 'react'
import { contrastingText, normalizeHex } from '../colors'
import { PickerPopover } from './picker-popover'

interface ColorPickerProps {
  title: string
  /** Rows of swatches; the greyscale strip is prepended for the text picker. */
  swatches: readonly (readonly string[])[]
  /** Label of the button that clears the colour, or null when it cannot be cleared. */
  resetLabel: string | null
  onPick: (hex: string) => void
  onReset: () => void
  onClose: () => void
}

export function ColorPicker({
  title,
  swatches,
  resetLabel,
  onPick,
  onReset,
  onClose,
}: ColorPickerProps) {
  const [custom, setCustom] = useState('#')
  const normalizedCustom = normalizeHex(custom)

  const pick = (hex: string) => {
    onPick(hex)
    onClose()
  }

  return (
    <PickerPopover title={title} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {swatches.map((row, rowIndex) => (
          <div key={rowIndex} className="flex gap-1">
            {row.map((hex) => (
              <button
                key={hex}
                type="button"
                title={hex}
                aria-label={hex}
                onClick={() => {
                  pick(hex)
                }}
                className="h-6 w-6 rounded border border-border"
                style={{ backgroundColor: hex, color: contrastingText(hex) }}
              />
            ))}
          </div>
        ))}

        <form
          className="flex items-center gap-2 border-t border-border pt-3"
          onSubmit={(event) => {
            event.preventDefault()
            if (normalizedCustom) pick(normalizedCustom)
          }}
        >
          <input
            value={custom}
            onChange={(event) => {
              setCustom(event.target.value)
            }}
            aria-label="Custom color"
            placeholder="#FF7A00"
            spellCheck={false}
            className="w-28 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
          />
          <button
            type="submit"
            disabled={!normalizedCustom}
            className="rounded bg-accent px-3 py-1 text-sm text-black disabled:opacity-40"
          >
            Apply
          </button>
          {resetLabel && (
            <button
              type="button"
              onClick={() => {
                onReset()
                onClose()
              }}
              className="ml-auto rounded border border-border px-3 py-1 text-sm text-text"
            >
              {resetLabel}
            </button>
          )}
        </form>
      </div>
    </PickerPopover>
  )
}
