import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import type { EditorState, Transaction } from '@tiptap/pm/state'
import type { Mark as ProseMirrorMark } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'

/**
 * Recording what the writer does as tracked changes.
 *
 * Two halves. Text that arrives is marked as an insertion, which can be done
 * after the fact — the range is known once the transaction has run. Text that
 * leaves cannot: once it is deleted there is nothing left to mark, so a
 * deletion has to be caught before it happens and turned into a mark instead.
 */

export const trackChangesKey = new PluginKey('trackChanges')

export interface TrackChangesOptions {
  /** Read on every change, so switching the mode on takes effect at once. */
  enabled: () => boolean
  /** Signed on the changes; empty is a document that says nobody made them. */
  author: () => string
}

function revisionAttrs(author: string): Record<string, string> {
  return {
    // Word wants an id per change; the clock gives one that no other change in
    // this document will repeat.
    revisionId: String(Date.now() % 1_000_000),
    author,
    date: new Date().toISOString(),
  }
}

/**
 * Marks a range as deleted rather than removing it.
 *
 * Text already marked as an insertion is removed outright: it was never in the
 * document anybody is reviewing, so marking it deleted would record a change to
 * something that was itself a change.
 */
function markDeleted(view: EditorView, from: number, to: number, author: string): void {
  const { state } = view
  const deletion = state.schema.marks['deletion']
  const insertion = state.schema.marks['insertion']
  if (!deletion || !insertion) return

  const tr = state.tr

  // Collected first: removing an own insertion moves everything after it.
  const ranges: { from: number; to: number; own: boolean }[] = []
  state.doc.nodesBetween(from, to, (node, position) => {
    if (!node.isText) return true

    const start = Math.max(from, position)
    const end = Math.min(to, position + node.nodeSize)
    if (start >= end) return true

    ranges.push({ from: start, to: end, own: node.marks.some((m) => m.type === insertion) })
    return true
  })

  for (const range of [...ranges].reverse()) {
    if (range.own) tr.delete(range.from, range.to)
    else tr.addMark(range.from, range.to, deletion.create(revisionAttrs(author)))
  }

  // The caret goes past what is now struck through rather than into it.
  tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(to)))
  view.dispatch(tr)
}

/**
 * The insertion the text just before `at` belongs to, by the same author.
 *
 * Returned so that typing on continues the change already being made rather
 * than starting another one for every character.
 */
function adjoiningInsertion(
  state: EditorState,
  at: number,
  author: string,
): ProseMirrorMark | null {
  if (at <= 0) return null

  const before = state.doc.resolve(at).nodeBefore
  if (!before?.isText) return null

  const mark = before.marks.find((candidate) => candidate.type.name === 'insertion')
  return mark !== undefined && mark.attrs['author'] === author ? mark : null
}

/** The range a transaction added, if it added one contiguous stretch. */
function insertedRange(transaction: Transaction): { from: number; to: number } | null {
  let range: { from: number; to: number } | null = null

  for (const step of transaction.steps) {
    const map = step.getMap()
    map.forEach((_fromA, _toA, fromB, toB) => {
      if (toB <= fromB) return
      range = range === null ? { from: fromB, to: toB } : { from: range.from, to: toB }
    })
  }

  return range
}

export const TrackChanges = Extension.create<TrackChangesOptions>({
  name: 'trackChanges',

  addOptions() {
    return { enabled: () => false, author: () => '' }
  },

  addProseMirrorPlugins() {
    const { enabled, author } = this.options

    return [
      new Plugin({
        key: trackChangesKey,

        /** Marks what arrived, once it is there to be marked. */
        appendTransaction(transactions, _oldState, newState) {
          if (!enabled()) return null
          if (!transactions.some((transaction) => transaction.docChanged)) return null
          // A transaction of our own, or one settling changes, must not be
          // recorded as a change in its turn.
          if (transactions.some((transaction) => transaction.getMeta(trackChangesKey) === true)) {
            return null
          }

          const insertion = newState.schema.marks['insertion']
          if (!insertion) return null

          const added = transactions.map(insertedRange).filter((range) => range !== null)
          if (added.length === 0) return null

          const tr = newState.tr.setMeta(trackChangesKey, true)
          for (const range of added) {
            // One continuous edit is one change. A fresh id and timestamp per
            // keystroke would keep the text nodes from merging, and the file
            // would carry a `w:ins` around every single character.
            const existing = adjoiningInsertion(newState, range.from, author())
            tr.addMark(
              range.from,
              range.to,
              existing ?? insertion.create(revisionAttrs(author())),
            )
          }

          return tr
        },

        props: {
          /**
           * Catches a deletion before it happens.
           *
           * Backspace and Delete over a selection, and over the character
           * beside the caret, are the ways text leaves by hand.
           */
          handleKeyDown(view: EditorView, event: KeyboardEvent) {
            if (!enabled()) return false
            if (event.key !== 'Backspace' && event.key !== 'Delete') return false

            const { selection, doc } = view.state
            if (!selection.empty) {
              markDeleted(view, selection.from, selection.to, author())
              return true
            }

            const at = selection.from
            const from = event.key === 'Backspace' ? at - 1 : at
            const to = from + 1
            if (from < 0 || to > doc.content.size) return false

            markDeleted(view, from, to, author())
            return true
          },

          /** Typing over a selection replaces it, so the old text is a deletion. */
          handleTextInput(view: EditorView, from: number, to: number, text: string) {
            if (!enabled() || from === to) return false

            markDeleted(view, from, to, author())

            // Typed here rather than left to the editor: it would insert over
            // the range just marked, taking the record out again with it.
            const at = view.state.selection.from
            view.dispatch(view.state.tr.insertText(text, at, at))
            return true
          },
        },
      }),
    ]
  },
})

/** Whether anything in the state is a tracked change, for the UI to read. */
export function hasRevisions(state: EditorState): boolean {
  let found = false

  state.doc.descendants((node) => {
    if (found) return false
    if (node.isText && node.marks.some((mark) => mark.type.name.endsWith('sertion'))) found = true
    return !found
  })

  return found
}
