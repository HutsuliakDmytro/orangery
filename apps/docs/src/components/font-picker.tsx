import { useState } from 'react'
import { ALL_FONTS, BUNDLED_FONTS } from '../editor/fonts'
import {
  clampFontSize,
  FONT_SIZE_PRESETS,
  MAX_FONT_SIZE,
  MIN_FONT_SIZE,
} from '@orangery/editor-text'
import { PickerPopover } from './picker-popover'

export function FontFamilyPicker({
  current,
  onPick,
  onClose,
}: {
  current: string | null
  onPick: (family: string) => void
  onClose: () => void
}) {
  return (
    <PickerPopover title="Font" onClose={onClose}>
      <ul className="max-h-[50vh] w-64 overflow-auto">
        {ALL_FONTS.map((font) => (
          <li key={font.family}>
            <button
              type="button"
              aria-selected={font.family === current}
              onClick={() => {
                onPick(font.family)
                onClose()
              }}
              style={{ fontFamily: font.stack }}
              className={`flex w-full items-center justify-between rounded px-3 py-2 text-left text-sm text-text ${
                font.family === current ? 'bg-accent-soft' : ''
              }`}
            >
              <span>{font.label}</span>
              {BUNDLED_FONTS.includes(font) && (
                <span className="font-ui text-xs text-muted">bundled</span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </PickerPopover>
  )
}

export function FontSizePicker({
  current,
  onPick,
  onClose,
}: {
  current: number | null
  onPick: (size: number) => void
  onClose: () => void
}) {
  const [value, setValue] = useState(current === null ? '' : String(current))
  const parsed = Number.parseFloat(value)
  const isValid = Number.isFinite(parsed) && parsed >= MIN_FONT_SIZE && parsed <= MAX_FONT_SIZE

  const apply = (size: number) => {
    onPick(clampFontSize(size))
    onClose()
  }

  return (
    <PickerPopover title="Font size" onClose={onClose}>
      <form
        className="mb-3 flex items-center gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          if (isValid) apply(parsed)
        }}
      >
        <input
          value={value}
          onChange={(event) => {
            setValue(event.target.value)
          }}
          inputMode="decimal"
          aria-label="Font size in points"
          className="w-20 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
        />
        <span className="text-sm text-muted">pt</span>
        <button
          type="submit"
          disabled={!isValid}
          className="ml-auto rounded bg-accent px-3 py-1 text-sm text-black disabled:opacity-40"
        >
          Apply
        </button>
      </form>

      <ul className="grid max-h-[40vh] w-56 grid-cols-4 gap-1 overflow-auto">
        {FONT_SIZE_PRESETS.map((size) => (
          <li key={size}>
            <button
              type="button"
              aria-selected={size === current}
              onClick={() => {
                apply(size)
              }}
              className={`w-full rounded px-2 py-1 text-sm text-text ${
                size === current ? 'bg-accent-soft' : ''
              }`}
            >
              {size}
            </button>
          </li>
        ))}
      </ul>
    </PickerPopover>
  )
}
