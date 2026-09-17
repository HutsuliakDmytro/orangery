import { Mark, mergeAttributes } from '@tiptap/core'

/**
 * The stretch of text a comment is about.
 *
 * A mark rather than a node, because a comment does not replace the text it is
 * on and can overlap another — two people can comment on phrases that cross.
 * What the comment says lives in its own part of the file; this only says where
 * it applies.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    comment: {
      setComment: (commentId: number) => ReturnType
      unsetComment: (commentId: number) => ReturnType
    }
  }
}

export const CommentMark = Mark.create({
  name: 'comment',

  // Two comments can cover the same words, so one must not replace the other.
  excludes: '',
  inclusive: false,

  addAttributes() {
    return {
      commentId: {
        default: null,
        parseHTML: (element: HTMLElement) => {
          const value = Number.parseInt(element.getAttribute('data-comment') ?? '', 10)
          return Number.isFinite(value) ? value : null
        },
        renderHTML: (attributes: Record<string, unknown>) => {
          const id = attributes['commentId']
          return typeof id === 'number' ? { 'data-comment': String(id) } : {}
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-comment]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'comment-range' }), 0]
  },

  addCommands() {
    return {
      setComment:
        (commentId) =>
        ({ commands }) =>
          commands.setMark(this.name, { commentId }),

      unsetComment:
        (commentId) =>
        ({ tr, state, dispatch }) => {
          const type = state.schema.marks[this.name]
          if (!type) return false

          // Removed wherever it is, not only under the cursor: a comment is
          // taken off as a whole, and its range may reach past the selection.
          state.doc.descendants((node, position) => {
            if (!node.isText) return true

            const mark = node.marks.find(
              (candidate) =>
                candidate.type.name === this.name && candidate.attrs['commentId'] === commentId,
            )
            if (mark) tr.removeMark(position, position + node.nodeSize, mark)
            return true
          })

          dispatch?.(tr)
          return true
        },
    }
  },
})
