import { useState } from 'react'
import {
  clampLineHeight,
  clampSpacing,
  LINE_HEIGHT_PRESETS,
  MAX_LINE_HEIGHT,
  MIN_LINE_HEIGHT,
} from '../editor/extensions/paragraph-spacing'
import { PickerPopover } from './picker-popover'

interface LineSpacingPickerProps {
  lineHeight: number | null
  spaceBefore: number | null
  spaceAfter: number | null
  onPickLineHeight: (multiplier: number) => void
  onPickSpacing: (spacing: { before: number; after: number }) => void
  onClose: () => void
}

export function LineSpacingPicker({
  lineHeight,
  spaceBefore,
  spaceAfter,
  onPickLineHeight,
  onPickSpacing,
  onClose,
}: LineSpacingPickerProps) {
  const [custom, setCustom] = useState(lineHeight === null ? '' : String(lineHeight))
  const [before, setBefore] = useState(String(spaceBefore ?? 0))
  const [after, setAfter] = useState(String(spaceAfter ?? 0))

  const customValue = Number.parseFloat(custom)
  const isCustomValid =
    Number.isFinite(customValue) && customValue >= MIN_LINE_HEIGHT && customValue <= MAX_LINE_HEIGHT

  return (
    <PickerPopover title="Line spacing" onClose={onClose}>
      <ul className="mb-3 w-56">
        {LINE_HEIGHT_PRESETS.map((preset) => (
          <li key={preset}>
            <button
              type="button"
              aria-selected={preset === lineHeight}
              onClick={() => {
                onPickLineHeight(preset)
                onClose()
              }}
              className={`w-full rounded px-3 py-2 text-left text-sm text-text ${
                preset === lineHeight ? 'bg-accent-soft' : ''
              }`}
            >
              {preset === 1 ? 'Single' : preset === 2 ? 'Double' : preset}
            </button>
          </li>
        ))}
      </ul>

      <form
        className="flex items-center gap-2 border-t border-border pt-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (isCustomValid) {
            onPickLineHeight(clampLineHeight(customValue))
            onClose()
          }
        }}
      >
        <label className="text-sm text-muted" htmlFor="custom-line-height">
          Custom
        </label>
        <input
          id="custom-line-height"
          value={custom}
          onChange={(event) => {
            setCustom(event.target.value)
          }}
          inputMode="decimal"
          className="w-20 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
        />
        <button
          type="submit"
          disabled={!isCustomValid}
          className="ml-auto rounded bg-accent px-3 py-1 text-sm text-black disabled:opacity-40"
        >
          Apply
        </button>
      </form>

      <form
        className="mt-3 flex items-end gap-2 border-t border-border pt-3"
        onSubmit={(event) => {
          event.preventDefault()
          onPickSpacing({
            before: clampSpacing(Number.parseFloat(before)),
            after: clampSpacing(Number.parseFloat(after)),
          })
          onClose()
        }}
      >
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor="space-before">
            Before (pt)
          </label>
          <input
            id="space-before"
            value={before}
            onChange={(event) => {
              setBefore(event.target.value)
            }}
            inputMode="decimal"
            className="w-20 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted" htmlFor="space-after">
            After (pt)
          </label>
          <input
            id="space-after"
            value={after}
            onChange={(event) => {
              setAfter(event.target.value)
            }}
            inputMode="decimal"
            className="w-20 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
          />
        </div>
        <button
          type="submit"
          className="ml-auto rounded border border-border px-3 py-1 text-sm text-text"
        >
          Apply
        </button>
      </form>
    </PickerPopover>
  )
}
