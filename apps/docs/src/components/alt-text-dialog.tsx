import { useState } from 'react'
import { PickerPopover } from '@orangery/ui-kit'

/**
 * Alt text for an image.
 *
 * Its own dialog rather than `window.prompt`, which in a Tauri webview renders
 * as a browser alert — out of place in a native-feeling app, and unstyleable.
 */
export function AltTextDialog({
  current,
  onApply,
  onClose,
}: {
  current: string
  onApply: (alt: string) => void
  onClose: () => void
}) {
  const [alt, setAlt] = useState(current)

  return (
    <PickerPopover title="Alt text" onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          onApply(alt.trim())
          onClose()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">
            Describe this image for people who cannot see it.
          </span>
          <textarea
            value={alt}
            onChange={(event) => {
              setAlt(event.target.value)
            }}
            rows={3}
            autoFocus
            className="resize-none rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
          />
        </label>

        <div className="flex justify-end gap-2">
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
