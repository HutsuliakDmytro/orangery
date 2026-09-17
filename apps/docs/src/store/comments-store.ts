import { create } from 'zustand'
import { nextCommentId } from '../ooxml/comments'
import type { Comment } from '../ooxml/comments'

/**
 * The open document's comments.
 *
 * Beside the document rather than inside it, because a comment is not part of
 * the text: the body only says which words it is about, and the comment itself
 * lives in its own part of the file.
 */

export interface CommentsState {
  comments: Map<number, Comment>
  load: (comments: Map<number, Comment>) => void
  /** Adds a comment and returns the id the body should anchor it with. */
  add: (author: string, text: string) => number
  update: (id: number, text: string) => void
  remove: (id: number) => void
  reset: () => void
}

/** Word shows initials on the bubble; a name gives them without being asked. */
export function initialsOf(author: string): string {
  return author
    .split(/\s+/u)
    .filter((part) => part !== '')
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export const useCommentsStore = create<CommentsState>((set, get) => ({
  comments: new Map(),

  load: (comments) => {
    set({ comments: new Map(comments) })
  },

  add: (author, text) => {
    const comments = new Map(get().comments)
    const id = nextCommentId(comments)

    comments.set(id, {
      id,
      author,
      initials: initialsOf(author),
      date: new Date().toISOString(),
      text,
    })

    set({ comments })
    return id
  },

  update: (id, text) => {
    const comments = new Map(get().comments)
    const existing = comments.get(id)
    if (!existing) return

    comments.set(id, { ...existing, text })
    set({ comments })
  },

  remove: (id) => {
    const comments = new Map(get().comments)
    comments.delete(id)
    set({ comments })
  },

  reset: () => {
    set({ comments: new Map() })
  },
}))
