import { useState } from 'react'
import {
  addComment,
  readComments,
  removeComment,
  replyToComment,
  resolveComment,
} from '@orangery/ooxml-presentation'
import { currentSlide, useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'

/**
 * What people have said about the slide showing.
 *
 * One slide at a time, because that is what a comment is about and a list of a
 * whole deck's remarks is a list nobody reads in order.
 *
 * A remark in the older format is a remark on its own: that format has no
 * replies and no status, so answering one means making another, which is what
 * it already meant in PowerPoint 2007. A thread from a newer PowerPoint is
 * shown as a thread and can be answered and marked as dealt with — both are one
 * element or one attribute written where PowerPoint has already written its
 * own. Deleting one is still not offered: taking a single remark out of a
 * conversation is a different operation, and done badly it loses the rest.
 */

/** Who a comment made here is from, until there is somewhere to say otherwise. */
const ME = { name: 'Me', initials: 'M' }

export function CommentsPanel() {
  const open = useDeckStore((state) => state.open)
  const slide = useDeckStore(currentSlide)
  const editPackage = useDeckStore((state) => state.editPackage)
  const showing = useViewStore((state) => state.commenting)
  const setShowing = useViewStore((state) => state.setCommenting)

  const [text, setText] = useState('')
  /** The thread being answered, and what is typed into it so far. */
  const [answering, setAnswering] = useState<{ id: string; text: string } | null>(null)

  if (!showing || open === null || slide === null) return null
  const comments = readComments(open.package, slide)

  const say = () => {
    if (text.trim() === '') return
    editPackage((deck) => addComment(deck.package, slide, { author: ME, text }) !== null)
    setText('')
  }

  const answer = () => {
    if (answering === null || answering.text.trim() === '') return
    const { id, text: said } = answering
    editPackage((deck) => replyToComment(deck.package, slide, id, { author: ME, text: said }))
    setAnswering(null)
  }

  return (
    <section
      aria-label="Comments"
      className="flex w-64 shrink-0 flex-col gap-2 overflow-y-auto border-l border-border bg-surface p-2 text-xs"
    >
      <header className="flex items-center gap-2">
        <h2 className="flex-1 uppercase tracking-wide text-muted">Comments</h2>
        <button
          type="button"
          aria-label="Close comments"
          onClick={() => {
            setShowing(false)
          }}
          className="rounded border border-border px-1.5 py-0.5 text-muted"
        >
          ×
        </button>
      </header>

      {comments.length === 0 ? (
        <p className="text-muted">Nothing has been said about this slide.</p>
      ) : (
        <ul className="space-y-2">
          {comments.map((comment) => (
            <li key={comment.id} className="space-y-1 rounded border border-border p-2">
              <div className="flex items-baseline gap-1">
                <span className="font-medium text-text">{comment.author.name}</span>
                {comment.resolved && <span className="text-muted">— resolved</span>}
                {comment.editable && (
                  <button
                    type="button"
                    aria-label={`Delete comment by ${comment.author.name}`}
                    onClick={() => {
                      editPackage((deck) => removeComment(deck.package, slide, comment.id))
                    }}
                    className="ml-auto rounded border border-border px-1 text-muted"
                  >
                    ×
                  </button>
                )}
              </div>
              <p className="whitespace-pre-wrap text-text">{comment.text}</p>

              {comment.replies.length > 0 && (
                <ul className="space-y-1 border-l border-border pl-2">
                  {comment.replies.map((reply) => (
                    <li key={reply.id} className="space-y-0.5">
                      <span className="font-medium text-text">{reply.author.name}</span>
                      <p className="whitespace-pre-wrap text-text">{reply.text}</p>
                    </li>
                  ))}
                </ul>
              )}

              {comment.threaded && (
                <div className="flex items-center gap-1 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setAnswering(
                        answering?.id === comment.id ? null : { id: comment.id, text: '' },
                      )
                    }}
                    className="rounded border border-border px-1.5 py-0.5 text-muted"
                  >
                    Reply
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      editPackage((deck) =>
                        resolveComment(deck.package, slide, comment.id, !comment.resolved),
                      )
                    }}
                    className="rounded border border-border px-1.5 py-0.5 text-muted"
                  >
                    {comment.resolved ? 'Reopen' : 'Resolve'}
                  </button>
                </div>
              )}

              {answering?.id === comment.id && (
                <div className="space-y-1 pt-1">
                  <textarea
                    aria-label={`Reply to ${comment.author.name}`}
                    value={answering.text}
                    rows={2}
                    onChange={(event) => {
                      setAnswering({ id: comment.id, text: event.target.value })
                    }}
                    className="w-full rounded border border-border bg-transparent px-2 py-1 text-text outline-none focus:border-accent"
                  />
                  <button
                    type="button"
                    onClick={answer}
                    disabled={answering.text.trim() === ''}
                    className="w-full rounded bg-accent px-2 py-1 text-black disabled:bg-surface-2 disabled:text-muted"
                  >
                    Send reply
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-auto space-y-1">
        <textarea
          aria-label="New comment"
          value={text}
          rows={3}
          onChange={(event) => {
            setText(event.target.value)
          }}
          className="w-full rounded border border-border bg-transparent px-2 py-1 text-text outline-none focus:border-accent"
        />
        <button
          type="button"
          onClick={say}
          disabled={text.trim() === ''}
          className="w-full rounded bg-accent px-2 py-1 text-black disabled:bg-surface-2 disabled:text-muted"
        >
          Comment
        </button>
      </div>
    </section>
  )
}
