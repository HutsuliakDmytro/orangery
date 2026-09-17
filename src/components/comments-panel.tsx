import { useCurrentEditor, useEditorState } from '@tiptap/react'
import { useCommentsStore } from '../store/comments-store'
import { useDocumentStore } from '../store/document-store'

/**
 * The comments on the document, beside the page.
 *
 * A panel rather than bubbles pinned to the text: a bubble has to be placed
 * against a line, and this editor's layout is a continuous column where a line
 * moves whenever anything above it does.
 */
export function CommentsPanel() {
  const { editor } = useCurrentEditor()
  const comments = useCommentsStore((state) => state.comments)
  const update = useCommentsStore((state) => state.update)
  const remove = useCommentsStore((state) => state.remove)
  const markDirty = useDocumentStore((state) => state.markDirty)

  /** The comment the cursor is inside, so the panel follows the text. */
  const active = useEditorState({
    editor: editor ?? null,
    selector: ({ editor: instance }) => {
      const id: unknown = instance?.getAttributes('comment')['commentId']
      return typeof id === 'number' ? id : -1
    },
  })

  if (comments.size === 0) return null

  return (
    <aside
      aria-label="Comments"
      className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-surface p-2"
    >
      {[...comments.values()].map((comment) => (
        <article
          key={comment.id}
          className={`rounded border p-2 text-xs ${
            active === comment.id ? 'border-accent bg-accent-soft' : 'border-border'
          }`}
        >
          <header className="flex items-baseline gap-2">
            <span className="font-medium text-text">{comment.author || 'Unknown'}</span>
            <span className="text-[10px] text-muted">
              {comment.date === '' ? '' : new Date(comment.date).toLocaleDateString()}
            </span>
            <button
              type="button"
              aria-label={`Delete comment by ${comment.author || 'Unknown'}`}
              onClick={() => {
                // The text and the range go together: a comment left anchored to
                // words nobody can open is worse than none.
                editor?.chain().focus().unsetComment(comment.id).run()
                remove(comment.id)
                markDirty()
              }}
              className="ml-auto text-muted hover:text-text"
            >
              ×
            </button>
          </header>

          <textarea
            value={comment.text}
            aria-label={`Comment by ${comment.author || 'Unknown'}`}
            onChange={(event) => {
              update(comment.id, event.target.value)
              markDirty()
            }}
            rows={3}
            className="mt-1 w-full resize-none rounded border border-transparent bg-transparent text-text outline-none focus:border-border"
          />
        </article>
      ))}
    </aside>
  )
}
