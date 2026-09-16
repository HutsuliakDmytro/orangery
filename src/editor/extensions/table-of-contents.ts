import { Node, mergeAttributes } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'
import { headingNumbers } from '../heading-numbers'
import type { HeadingNumberScheme } from '../heading-numbers'
import type { OutlineEntry } from '../outline'

/**
 * Table of contents.
 *
 * A generated block, not a snapshot pasted into the text: the entries are
 * rebuilt from the document's headings on demand. Word models it as a field
 * (`TOC \o "1-3"`) that stays stale until refreshed, which is exactly the
 * behaviour people complain about — here the refresh is one click.
 *
 * When the document numbers its headings, the entries carry the same numbers —
 * from the same computation that draws them beside the headings, so the table
 * and the page cannot disagree.
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
  /** The heading's number, when the document numbers its headings. */
  number?: string
}

export interface TableOfContentsOptions {
  /** The scheme numbering the headings, or null when they are not numbered. */
  scheme: () => HeadingNumberScheme | null
}

export const TableOfContents = Node.create<TableOfContentsOptions>({
  name: 'tableOfContents',
  group: 'block',
  atom: true,
  selectable: true,

  addOptions() {
    return { scheme: () => null }
  },

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
      ...list.map((entry, index) => [
        'div',
        {
          class: 'toc-entry',
          'data-level': String(entry.level),
          // The position of the heading moves as the document is edited, so the
          // entry records which heading it is rather than where that was.
          'data-index': String(index),
        },
        entry.number === undefined ? entry.text : `${entry.number} ${entry.text}`,
      ]),
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('tableOfContentsNavigation'),
        props: {
          handleDOMEvents: {
            mousedown: (view, event) => {
              const target = event.target
              if (!(target instanceof HTMLElement)) return false

              const entry = target.closest('.toc-entry')
              const index = Number.parseInt(entry?.getAttribute('data-index') ?? '', 10)
              if (!Number.isFinite(index)) return false

              const heading = headingAt(view.state.doc, index)
              if (heading === null) return false

              // Placed inside the heading rather than on it, so the caret lands
              // in the text and typing continues from there.
              const selection = TextSelection.create(view.state.doc, heading + 1)
              view.dispatch(view.state.tr.setSelection(selection).scrollIntoView())
              view.focus()

              event.preventDefault()
              return true
            },
          },
        },
      }),
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
        ({ tr, dispatch }) => {
          // Read from the transaction rather than from the editor: in a chain
          // the editor still holds the state from before it, so a table
          // inserted and refreshed in one go would find nothing to fill in.
          const entries = collectEntries(tr.doc, this.options.scheme())

          // Collected first rather than updated inside the walk: a flag set in
          // the callback is invisible to the type checker, and reading the
          // positions up front makes the "nothing to refresh" case explicit.
          const blocks: { position: number; attrs: Record<string, unknown> }[] = []

          tr.doc.descendants((node, position) => {
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
function collectEntries(doc: ProseMirrorNode, scheme: HeadingNumberScheme | null): TocEntry[] {
  // The numbers come from the same function that draws them beside the
  // headings, so an entry can never be numbered differently from its heading.
  const numbers = scheme === null ? [] : headingNumbers(doc, scheme)
  const entries: TocEntry[] = []

  doc.descendants((node) => {
    if (node.type.name !== 'heading') return true

    const level: unknown = node.attrs['level']
    const number = numbers[entries.length]?.label

    entries.push({
      level: typeof level === 'number' ? level : 1,
      text: node.textContent.trim(),
      ...(number === undefined ? {} : { number }),
    })
    return false
  })

  return entries
}

/** The position of the nth heading, or null when the document has fewer. */
function headingAt(doc: ProseMirrorNode, index: number): number | null {
  let seen = 0
  let found: number | null = null

  doc.descendants((node, position) => {
    if (found !== null) return false
    if (node.type.name !== 'heading') return true

    if (seen === index) found = position
    seen += 1
    return false
  })

  return found
}

/** Shared with the outline panel, which builds the same list for navigation. */
export function entriesFromOutline(outline: readonly OutlineEntry[], maxLevel = 3): TocEntry[] {
  return outline
    .filter((entry) => entry.level <= maxLevel)
    .map((entry) => ({ level: entry.level, text: entry.text }))
}
