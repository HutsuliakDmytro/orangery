import { Extension, Mark, mergeAttributes } from '@tiptap/core'
import type { Mark as ProseMirrorMark, Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import { trackChangesKey } from './track-changes'

/**
 * Tracked changes — what somebody did to the text, not how it looks.
 *
 * An insertion marks text that was added; a deletion marks text that was taken
 * out and is still shown, struck through, until someone decides. Accepting and
 * rejecting are mirror images: accepting keeps what was inserted and removes
 * what was deleted, rejecting does the opposite.
 */

export type RevisionKind = 'insertion' | 'deletion' | 'formatChange'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    revisions: {
      /** Settles the tracked changes in the selection, or in the whole document. */
      acceptRevisions: (all?: boolean) => ReturnType
      rejectRevisions: (all?: boolean) => ReturnType
    }
  }
}

function revisionMark(name: 'insertion' | 'deletion', className: string) {
  return Mark.create({
    name,

    // A run can be inserted by one person and deleted by another, so neither
    // mark may exclude the other.
    excludes: '',

    // A change covers the text it was made to and nothing else. Left
    // inclusive, text typed against the edge of a deletion would be marked as
    // deleted too — and then dropped by the accept that follows.
    inclusive: false,

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

/**
 * A change of formatting, with what the formatting was.
 *
 * Word records this as `w:rPrChange`: the run carries its new properties and,
 * inside them, the old ones. Rejecting has to put those back, so they are held
 * here rather than worked out again from a document that no longer has them.
 */
export const FormatChange = Mark.create({
  name: 'formatChange',
  excludes: '',
  inclusive: false,

  addAttributes() {
    return {
      revisionId: { default: null },
      author: { default: null },
      date: { default: null },
      /** The marks the text wore before, as JSON. */
      previous: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-revision="format"]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, { 'data-revision': 'format', class: 'revision-format' }),
      0,
    ]
  },
})

/** Marks recorded on a format change, as the serializer and the undo need them. */
export interface RecordedMark {
  type: string
  attrs: Record<string, unknown>
}

export function decodeMarks(value: unknown): RecordedMark[] {
  if (typeof value !== 'string' || value === '') return []

  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) ? (parsed as RecordedMark[]) : []
  } catch {
    // Written by us, but a document can be edited by anything; a record that
    // cannot be read is one change that cannot be rejected, not a crash.
    return []
  }
}

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

/**
 * Puts the formatting back to what a change replaced.
 *
 * Only the marks that describe how text looks: the record of the change itself,
 * and anything saying who inserted or deleted the text, are not formatting and
 * must survive being reformatted.
 */
function restoreFormatting(
  tr: Transaction,
  state: EditorState,
  from: number,
  to: number,
  previous: RecordedMark[],
): void {
  for (const [name, type] of Object.entries(state.schema.marks)) {
    if (name === 'insertion' || name === 'deletion' || name === 'formatChange') continue
    tr.removeMark(from, to, type)
  }

  for (const mark of previous) {
    const type = state.schema.marks[mark.type]
    if (type) tr.addMark(from, to, type.create(mark.attrs))
  }
}

/** Settles the changes: `keep` survives as plain text, `drop` goes away. */
function settle(
  tr: Transaction,
  state: EditorState,
  keep: RevisionKind,
  drop: RevisionKind,
  within: { from: number; to: number } | null,
): void {
  const doc = state.doc

  // Marks come off first: removing one shifts nothing, while a deletion moves
  // every position after it — and both passes were measured against this doc.
  for (const range of revisionRanges(doc, keep, within)) {
    tr.removeMark(range.from, range.to, range.mark)
  }

  // A rejected formatting change is undone; an accepted one simply stops being
  // a change. Either way the record of it goes.
  for (const range of revisionRanges(doc, 'formatChange', within)) {
    if (drop === 'insertion') {
      restoreFormatting(tr, state, range.from, range.to, decodeMarks(range.mark.attrs['previous']))
    }
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

        // Settling is not itself an edit: without this the recorder sees the
        // marks coming off and records that as a change of formatting, so
        // accepting a change would leave a new one behind.
        tr.setMeta(trackChangesKey, true)
        settle(tr, state, keep, drop, within)
        dispatch?.()
        return true
      }

    return {
      acceptRevisions: settleWith('insertion', 'deletion'),
      rejectRevisions: settleWith('deletion', 'insertion'),
    }
  },
})
