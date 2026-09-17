import { useState } from 'react'
import { normalizeUrl } from '../editor/links'
import { PickerPopover } from '@orangery/ui-kit'

interface LinkDialogProps {
  /** Existing href when editing a link, null when creating one. */
  href: string | null
  /** Text currently selected; becomes the link text when nothing is selected. */
  selectedText: string
  onApply: (url: string, text: string) => void
  onRemove: () => void
  onClose: () => void
}

export function LinkDialog({ href, selectedText, onApply, onRemove, onClose }: LinkDialogProps) {
  const [url, setUrl] = useState(href ?? '')
  const [text, setText] = useState(selectedText)

  const normalized = normalizeUrl(url)
  const isEditing = href !== null

  return (
    <PickerPopover title={isEditing ? 'Edit link' : 'Insert link'} onClose={onClose}>
      <form
        className="flex w-80 flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!normalized) return
          onApply(normalized, text.trim() === '' ? normalized : text)
          onClose()
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Text</span>
          <input
            value={text}
            onChange={(event) => {
              setText(event.target.value)
            }}
            className="rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-xs text-muted">Link</span>
          <input
            value={url}
            onChange={(event) => {
              setUrl(event.target.value)
            }}
            placeholder="example.com"
            spellCheck={false}
            autoFocus
            className="rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
          />
        </label>

        {url.trim() !== '' && !normalized && (
          <p className="text-xs text-danger">Only http, https, mailto and tel links are allowed.</p>
        )}

        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={!normalized}
            className="rounded bg-accent px-3 py-1 text-sm text-black disabled:opacity-40"
          >
            Apply
          </button>
          {isEditing && (
            <button
              type="button"
              onClick={() => {
                onRemove()
                onClose()
              }}
              className="ml-auto rounded border border-border px-3 py-1 text-sm text-text"
            >
              Remove
            </button>
          )}
        </div>
      </form>
    </PickerPopover>
  )
}
