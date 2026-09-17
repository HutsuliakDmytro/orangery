import { Extension, Mark, mergeAttributes } from '@tiptap/core'
import type { Mark as ProseMirrorMark, Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'

/**
 * Tracked changes — what somebody did to the text, not how it looks.
 *
 * An insertion marks text that was added; a deletion marks text that was taken
 * out and is still shown, struck through, until someone decides. Accepting and
 * rejecting are mirror images: accepting keeps what was inserted and removes
 * what was deleted, rejecting does the opposite.
 */

export type RevisionKind = 'insertion' | 'deletion'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    revisions: {
      /** Settles the tracked changes in the selection, or in the whole document. */
      acceptRevisions: (all?: boolean) => ReturnType
      rejectRevisions: (all?: boolean) => ReturnType
    }
  }
}

function revisionMark(name: RevisionKind, className: string) {
  return Mark.create({
    name,

    // A run can be inserted by one person and deleted by another, so neither
    // mark may exclude the other.
    excludes: '',

    addAttributes() {
      return {
        revisionId: { default: null },
        author: { default: null },
        date: { default: null },
      }
    },

    parseHTML() {
      return [{ tag: `span[data-revision="${name}"]` }]
    },

    renderHTML({ HTMLAttributes }) {
      return [
        'span',
        mergeAttributes(HTMLAttributes, { 'data-revision': name, class: className }),
        0,
      ]
    },
  })
}

export const Insertion = revisionMark('insertion', 'revision-insertion')
export const Deletion = revisionMark('deletion', 'revision-deletion')

interface RevisionRange {
  from: number
  to: number
  mark: ProseMirrorMark
}

/**
 * Where a revision mark applies, latest first.
 *
 * Reversed so that removing one range does not move the ones still to be
 * handled: they were all measured against the document as it stands now.
 */
export function revisionRanges(
  doc: ProseMirrorNode,
  kind: RevisionKind,
  within: { from: number; to: number } | null,
): RevisionRange[] {
  const ranges: RevisionRange[] = []

  doc.descendants((node, position) => {
    if (!node.isText) return true

    const mark = node.marks.find((candidate) => candidate.type.name === kind)
    if (!mark) return true

    const to = position + node.nodeSize
    // A range the selection does not touch is somebody else's to settle.
    if (within !== null && (to <= within.from || position >= within.to)) return true

    ranges.push({ from: position, to, mark })
    return true
  })

  return ranges.reverse()
}

/** Settles the changes: `keep` survives as plain text, `drop` goes away. */
function settle(
  tr: Transaction,
  doc: ProseMirrorNode,
  keep: RevisionKind,
  drop: RevisionKind,
  within: { from: number; to: number } | null,
): void {
  // Marks come off first: removing one shifts nothing, while a deletion moves
  // every position after it — and both passes were measured against this doc.
  for (const range of revisionRanges(doc, keep, within)) {
    tr.removeMark(range.from, range.to, range.mark)
  }

  for (const range of revisionRanges(doc, drop, within)) tr.delete(range.from, range.to)
}

export const Revisions = Extension.create({
  name: 'revisions',

  addCommands() {
    const settleWith =
      (keep: RevisionKind, drop: RevisionKind) =>
      (all = false) =>
      ({ tr, state, dispatch }: { tr: Transaction; state: EditorState; dispatch?: () => void }) => {
        const within = all ? null : { from: state.selection.from, to: state.selection.to }

        settle(tr, state.doc, keep, drop, within)
        dispatch?.()
        return true
      }

    return {
      acceptRevisions: settleWith('insertion', 'deletion'),
      rejectRevisions: settleWith('deletion', 'insertion'),
    }
  },
})
