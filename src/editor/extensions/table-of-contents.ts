import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import type { OutlineEntry } from '../outline'

/**
 * Table of contents.
 *
 * A generated block, not a snapshot pasted into the text: the entries are
 * rebuilt from the document's headings on demand. Word models it as a field
 * (`TOC \o "1-3"`) that stays stale until refreshed, which is exactly the
 * behaviour people complain about — here the refresh is one click.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    tableOfContents: {
      insertTableOfContents: () => ReturnType
      refreshTableOfContents: () => ReturnType
    }
  }
}

export interface TocEntry {
  level: number
  text: string
}

export const TableOfContents = Node.create({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      /** Entries as of the last refresh, so the block survives a save. */
      entries: { default: [] as TocEntry[] },
      /** Heading levels included, matching Word's `\o "1-3"` switch. */
      maxLevel: { default: 3 },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-toc]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const entries: unknown = node.attrs['entries']
    const list = Array.isArray(entries) ? (entries as TocEntry[]) : []

    return [
      'div',
      mergeAttributes(HTMLAttributes, { 'data-toc': 'true', class: 'table-of-contents' }),
      ...list.map((entry) => [
        'div',
        { class: 'toc-entry', 'data-level': String(entry.level) },
        entry.text,
      ]),
    ]
  },

  addCommands() {
    return {
      insertTableOfContents:
        () =>
        ({ chain, state }) => {
          // Inserted at a block boundary, not at the caret: an atom dropped into
          // the middle of a heading splits it and leaves an empty one behind.
          const { $from } = state.selection
          const atBlockStart = $from.parentOffset === 0
          const position = atBlockStart ? $from.before($from.depth) : $from.after($from.depth)

          return chain().insertContentAt(position, { type: this.name }).run()
        },

      refreshTableOfContents:
        () =>
        ({ editor, tr, dispatch }) => {
          const entries = collectEntries(editor.state.doc)

          // Collected first rather than updated inside the walk: a flag set in
          // the callback is invisible to the type checker, and reading the
          // positions up front makes the "nothing to refresh" case explicit.
          const blocks: { position: number; attrs: Record<string, unknown> }[] = []

          editor.state.doc.descendants((node, position) => {
            if (node.type.name !== 'tableOfContents') return true
            blocks.push({ position, attrs: node.attrs })
            return false
          })

          if (blocks.length === 0) return false

          for (const block of blocks) {
            const maxLevel: unknown = block.attrs['maxLevel']
            const limit = typeof maxLevel === 'number' ? maxLevel : 3

            tr.setNodeMarkup(block.position, undefined, {
              ...block.attrs,
              entries: entries.filter((entry) => entry.level <= limit),
            })
          }

          dispatch?.(tr)
          return true
        },
    }
  },
})

/** Headings in document order, for the entries. */
function collectEntries(doc: ProseMirrorNode): TocEntry[] {
  const entries: TocEntry[] = []

  doc.descendants((node) => {
    if (node.type.name !== 'heading') return true

    const level: unknown = node.attrs['level']
    entries.push({ level: typeof level === 'number' ? level : 1, text: node.textContent.trim() })
    return false
  })

  return entries
}

/** Shared with the outline panel, which builds the same list for navigation. */
export function entriesFromOutline(outline: readonly OutlineEntry[], maxLevel = 3): TocEntry[] {
  return outline
    .filter((entry) => entry.level <= maxLevel)
    .map((entry) => ({ level: entry.level, text: entry.text }))
}
