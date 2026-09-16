import { useRef } from 'react'
import type { HeaderFooterKind } from '../ooxml/header-footer'

/**
 * Editing the header and footer on the page.
 *
 * A plain text field rather than a second rich-text editor: a header is almost
 * always a line of text plus a page number, and a full ProseMirror instance per
 * header would double the editor's cost on every document for a case that
 * rarely needs it. Anything richer that came from the file is preserved
 * untouched — this edits the text, it does not rebuild the part.
 */

export const PAGE_NUMBER_TOKEN = '{page}'
export const DATE_TOKEN = '{date}'

export function HeaderFooterEditor({
  kind,
  value,
  placeholder,
  onChange,
}: {
  kind: HeaderFooterKind
  value: string
  placeholder: string
  onChange: (value: string) => void
}) {
  // Fully controlled: the document owns the text, so there is no second copy
  // here to fall out of step when a file is opened.
  const input = useRef<HTMLInputElement>(null)

  const insertToken = (token: string) => {
    const element = input.current
    const at = element?.selectionStart ?? value.length

    onChange(`${value.slice(0, at)}${token}${value.slice(at)}`)
    element?.focus()
  }

  return (
    <div
      className={`flex items-center gap-2 px-4 py-1 text-xs ${
        kind === 'header' ? 'border-b' : 'border-t'
      } border-dashed border-border bg-surface`}
    >
      <span className="w-12 shrink-0 uppercase tracking-wide text-muted">
        {kind === 'header' ? 'Header' : 'Footer'}
      </span>

      <input
        ref={input}
        value={value}
        placeholder={placeholder}
        aria-label={kind === 'header' ? 'Header text' : 'Footer text'}
        onChange={(event) => {
          onChange(event.target.value)
        }}
        className="flex-1 rounded border border-transparent bg-transparent px-1 py-0.5 text-text outline-none focus:border-border"
      />

      <button
        type="button"
        title="Insert page number"
        onClick={() => {
          insertToken(PAGE_NUMBER_TOKEN)
        }}
        className="rounded border border-border px-1.5 py-0.5 text-muted"
      >
        #
      </button>
      <button
        type="button"
        title="Insert date"
        onClick={() => {
          insertToken(DATE_TOKEN)
        }}
        className="rounded border border-border px-1.5 py-0.5 text-muted"
      >
        date
      </button>
    </div>
  )
}
