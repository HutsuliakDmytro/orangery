import { Node, mergeAttributes } from '@tiptap/core'
import type { Node as ProseMirrorNode } from '@tiptap/pm/model'

/**
 * The footnote marker in the body text.
 *
 * An atom, not editable text: the number is generated from document order, so
 * letting the user type over it would immediately disagree with the note it
 * points at. The note's own text lives in the footnotes part and is edited in
 * the panel at the foot of the window.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    footnote: {
      insertFootnote: (text?: string) => ReturnType
      removeFootnote: () => ReturnType
    }
  }
}

export const Footnote = Node.create({
  name: 'footnote',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      /** Id into `word/footnotes.xml`. */
      footnoteId: { default: null },
      /** Note text, mirrored here so the panel can show it without a lookup. */
      text: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'sup[data-footnote]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const id: unknown = node.attrs['footnoteId']
    const text: unknown = node.attrs['text']

    return [
      'sup',
      mergeAttributes(HTMLAttributes, {
        'data-footnote': typeof id === 'number' ? String(id) : '',
        class: 'footnote-marker',
        title: typeof text === 'string' && text !== '' ? text : 'Footnote',
      }),
    ]
  },

  addCommands() {
    return {
      insertFootnote:
        (text = '') =>
        ({ chain, editor }) => {
          // Ids only have to be unique within the document; the display number
          // comes from position, so a gap in the ids is harmless.
          const used = new Set<number>()
          editor.state.doc.descendants((node) => {
            if (node.type.name !== 'footnote') return true
            const id: unknown = node.attrs['footnoteId']
            if (typeof id === 'number') used.add(id)
            return false
          })

          let footnoteId = 1
          while (used.has(footnoteId)) footnoteId += 1

          return chain().insertContent({ type: this.name, attrs: { footnoteId, text } }).run()
        },

      removeFootnote:
        () =>
        ({ chain, editor }) => {
          if (!editor.isActive('footnote')) return false
          return chain().deleteSelection().run()
        },
    }
  },
})

export interface FootnoteEntry {
  footnoteId: number
  text: string
  /** Document position, for scrolling to the marker. */
  position: number
}

/** Footnotes in document order, which is the order they are numbered in. */
export function footnotesInOrder(doc: ProseMirrorNode): FootnoteEntry[] {
  const found: FootnoteEntry[] = []

  doc.descendants((node, position) => {
    if (node.type.name !== 'footnote') return true

    const id: unknown = node.attrs['footnoteId']
    const text: unknown = node.attrs['text']
    if (typeof id === 'number') {
      found.push({ footnoteId: id, text: typeof text === 'string' ? text : '', position })
    }
    return false
  })

  return found
}
