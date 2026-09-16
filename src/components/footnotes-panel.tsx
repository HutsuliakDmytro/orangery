import { useCurrentEditor, useEditorState } from '@tiptap/react'
import { footnotesInOrder } from '../editor/extensions/footnote'

/**
 * The footnote area.
 *
 * Shown at the foot of the window rather than at the foot of each page: the MVP
 * has no real pagination, so there is no page foot to put it at. The numbering
 * follows document order, which is what will be printed.
 */
export function FootnotesPanel() {
  const { editor } = useCurrentEditor()

  const footnotes = useEditorState({
    editor,
    selector: ({ editor: instance }) => (instance ? footnotesInOrder(instance.state.doc) : []),
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  })

  if (!editor || (footnotes ?? []).length === 0) return null

  return (
    <section
      aria-label="Footnotes"
      className="max-h-40 shrink-0 overflow-auto border-t border-border bg-surface px-4 py-2"
    >
      <h2 className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Footnotes</h2>

      <ol className="flex flex-col gap-1">
        {(footnotes ?? []).map((footnote, index) => (
          <li
            key={`${String(footnote.footnoteId)}-${String(footnote.position)}`}
            className="flex gap-2 text-xs"
          >
            <button
              type="button"
              title="Go to this footnote in the text"
              onClick={() => {
                editor.chain().focus().setTextSelection(footnote.position).scrollIntoView().run()
              }}
              className="shrink-0 text-accent"
            >
              {`[${String(index + 1)}]`}
            </button>

            <input
              value={footnote.text}
              placeholder="Footnote text"
              aria-label={`Footnote ${String(index + 1)}`}
              onChange={(event) => {
                // Edited in place: the marker in the text carries the note, so
                // there is no second document to keep in step.
                editor
                  .chain()
                  .setNodeSelection(footnote.position)
                  .updateAttributes('footnote', { text: event.target.value })
                  .run()
              }}
              className="w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-text outline-none focus:border-border"
            />
          </li>
        ))}
      </ol>
    </section>
  )
}
