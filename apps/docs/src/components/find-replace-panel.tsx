import type { Editor } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { buildPattern, findPluginKey } from '../editor/extensions/find-replace'
import type { FindOptions } from '../editor/extensions/find-replace'

/**
 * Docked panel rather than a modal: Word and Docs both keep find visible while
 * the user edits, and a modal would steal the selection the replace acts on.
 */
export function FindReplacePanel({ editor, onClose }: { editor: Editor; onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [replacement, setReplacement] = useState('')
  const [options, setOptions] = useState<Omit<FindOptions, 'query'>>({
    caseSensitive: false,
    wholeWord: false,
    regex: false,
  })

  useEffect(() => {
    editor.commands.setFindOptions({ query, ...options })
  }, [editor, query, options])

  useEffect(() => {
    return () => {
      editor.commands.clearFind()
    }
  }, [editor])

  // Subscribed rather than read at render time: the options are applied in an
  // effect, so a plain read shows the count for the *previous* query — the
  // panel would report 0 / 0 for a term that is plainly in the document.
  const matchState = useEditorState({
    editor,
    selector: ({ editor: instance }) => {
      const find = findPluginKey.getState(instance.state)
      return { total: find?.matches.length ?? 0, activeIndex: find?.activeIndex ?? 0 }
    },
    // `b` is null on the first comparison, before a snapshot exists.
    equalityFn: (a, b) => b !== null && a.total === b.total && a.activeIndex === b.activeIndex,
  })

  const total = matchState.total
  const current = total === 0 ? 0 : matchState.activeIndex + 1
  const patternIsBroken =
    options.regex && query !== '' && buildPattern({ query, ...options }) === null

  const toggle = (key: keyof typeof options) => {
    setOptions((previous) => ({ ...previous, [key]: !previous[key] }))
  }

  return (
    <div
      role="dialog"
      aria-label="Find and replace"
      className="flex items-center gap-2 border-b border-border bg-surface px-3 py-2"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          onClose()
        }
      }}
    >
      <input
        value={query}
        onChange={(event) => {
          setQuery(event.target.value)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            if (event.shiftKey) editor.commands.findPrevious()
            else editor.commands.findNext()
          }
        }}
        placeholder="Find"
        aria-label="Find"
        autoFocus
        spellCheck={false}
        className={`w-48 rounded border bg-surface-2 px-2 py-1 text-sm text-text outline-none ${
          patternIsBroken ? 'border-danger' : 'border-border'
        }`}
      />

      <span className="w-20 text-xs text-muted" aria-live="polite">
        {patternIsBroken ? 'bad regex' : `${String(current)} / ${String(total)}`}
      </span>

      <button
        type="button"
        onClick={() => editor.commands.findPrevious()}
        aria-label="Find previous"
        className="rounded border border-border px-2 py-1 text-sm text-text"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => editor.commands.findNext()}
        aria-label="Find next"
        className="rounded border border-border px-2 py-1 text-sm text-text"
      >
        ↓
      </button>

      <input
        value={replacement}
        onChange={(event) => {
          setReplacement(event.target.value)
        }}
        placeholder="Replace with"
        aria-label="Replace with"
        spellCheck={false}
        className="w-48 rounded border border-border bg-surface-2 px-2 py-1 text-sm text-text outline-none"
      />

      <button
        type="button"
        disabled={total === 0}
        onClick={() => editor.commands.replaceCurrent(replacement)}
        className="rounded border border-border px-2 py-1 text-sm text-text disabled:opacity-40"
      >
        Replace
      </button>
      <button
        type="button"
        disabled={total === 0}
        onClick={() => editor.commands.replaceAll(replacement)}
        className="rounded border border-border px-2 py-1 text-sm text-text disabled:opacity-40"
      >
        All
      </button>

      <div className="ml-2 flex items-center gap-2 text-xs text-muted">
        {(
          [
            ['caseSensitive', 'Aa', 'Match case'],
            ['wholeWord', 'W', 'Whole word'],
            ['regex', '.*', 'Regular expression'],
          ] as const
        ).map(([key, label, title]) => (
          <button
            key={key}
            type="button"
            title={title}
            aria-label={title}
            aria-pressed={options[key]}
            onClick={() => {
              toggle(key)
            }}
            className={`rounded border px-2 py-1 ${
              options[key] ? 'border-accent bg-accent-soft text-text' : 'border-border'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onClose}
        aria-label="Close find and replace"
        className="ml-auto rounded px-2 py-1 text-sm text-muted"
      >
        ✕
      </button>
    </div>
  )
}
