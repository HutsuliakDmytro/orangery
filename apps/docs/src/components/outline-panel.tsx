import { useCurrentEditor, useEditorState } from '@tiptap/react'
import { buildOutline } from '../editor/outline'
import { useViewStore } from '../store/view-store'

/** Heading navigation, as in the Docs outline pane. */
export function OutlinePanel() {
  const { editor } = useCurrentEditor()
  const open = useViewStore((state) => state.outlineOpen)

  const outline = useEditorState({
    editor,
    selector: ({ editor: instance }) => (instance ? buildOutline(instance.state.doc) : []),
    // Rebuilt only when the headings actually change, not on every keystroke.
    equalityFn: (a, b) => JSON.stringify(a) === JSON.stringify(b),
  })

  if (!open) return null

  return (
    <aside
      aria-label="Document outline"
      className="w-56 shrink-0 overflow-auto border-r border-border bg-surface p-3"
    >
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wide text-muted">Outline</h2>

      {(outline ?? []).length === 0 ? (
        <p className="text-xs text-muted">Headings you add to the document will appear here.</p>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {(outline ?? []).map((entry) => (
            <li key={`${String(entry.position)}-${entry.text}`}>
              <button
                type="button"
                onClick={() => {
                  editor
                    ?.chain()
                    .focus()
                    .setTextSelection(entry.position + 1)
                    .scrollIntoView()
                    .run()
                }}
                style={{ paddingLeft: `${String(entry.depth * 12 + 4)}px` }}
                className="w-full truncate rounded py-1 pr-1 text-left text-xs text-text hover:bg-surface-2"
                title={entry.text}
              >
                {entry.text === '' ? 'Untitled heading' : entry.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  )
}
