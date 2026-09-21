import { useState } from 'react'
import { PickerPopover } from '@orangery/ui-kit'
import type { PasteFormatting } from '@orangery/ooxml-presentation'
import { clipboardHistory, pasteShapesHere } from '../document/shape-clipboard'
import { useViewStore } from '../store/view-store'

/**
 * Paste Special: which copy, and looking like what.
 *
 * Two questions in one place because they are asked at the same moment. The
 * clipboard holds one thing, which is right until you need the one before it —
 * so what this window copied last is remembered, up to a few, and any of them
 * can be the thing pasted.
 *
 * Only this window's own copies are listed. What another program put on the
 * clipboard is not ours to keep, and a list that quietly recorded it would be
 * keeping it.
 */

type Choice = PasteFormatting | 'text'

const CHOICES: readonly { value: Choice; label: string; hint: string }[] = [
  {
    value: 'destination',
    label: 'Use destination theme',
    hint: 'Takes this deck’s colours and fonts',
  },
  {
    value: 'source',
    label: 'Keep source formatting',
    hint: 'Looks like where it was copied from',
  },
  { value: 'text', label: 'Text only', hint: 'The words, in a new text box' },
]

export function PasteDialog() {
  const showing = useViewStore((state) => state.pasting)
  const setShowing = useViewStore((state) => state.setPasting)
  const [choice, setChoice] = useState<Choice>('destination')
  const [entry, setEntry] = useState<string | null>(null)

  if (!showing) return null
  const history = clipboardHistory()

  const paste = () => {
    setShowing(false)
    void pasteShapesHere({
      ...(choice === 'text' ? { textOnly: true } : { formatting: choice }),
      // Null means whatever is on the clipboard now, which is not always the
      // same as the newest thing this window copied.
      ...(entry === null ? {} : { entry }),
    })
  }

  return (
    <PickerPopover
      title="Paste Special"
      onClose={() => {
        setShowing(false)
      }}
    >
      <div className="w-80 space-y-3 text-xs text-text">
        <fieldset className="space-y-2">
          <legend className="mb-1 text-muted">Paste as</legend>
          {CHOICES.map((one) => (
            <label key={one.value} className="flex items-start gap-2">
              <input
                type="radio"
                name="paste-as"
                className="mt-0.5"
                checked={choice === one.value}
                onChange={() => {
                  setChoice(one.value)
                }}
              />
              <span>
                {one.label}
                <span className="block text-muted">{one.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        {history.length > 0 && (
          <fieldset className="space-y-2 border-t border-border pt-3">
            <legend className="mb-1 text-muted">From</legend>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="paste-from"
                checked={entry === null}
                onChange={() => {
                  setEntry(null)
                }}
              />
              The clipboard
            </label>

            {history.map((one) => (
              <label key={one.text} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="paste-from"
                  checked={entry === one.text}
                  onChange={() => {
                    setEntry(one.text)
                  }}
                />
                <span className="truncate">{one.label}</span>
              </label>
            ))}
          </fieldset>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={() => {
              setShowing(false)
            }}
            className="rounded border border-border px-3 py-1 hover:border-accent"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={paste}
            className="rounded bg-accent px-3 py-1 text-black hover:bg-accent-hover"
          >
            Paste
          </button>
        </div>
      </div>
    </PickerPopover>
  )
}
