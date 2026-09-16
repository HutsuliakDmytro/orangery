import { Node, mergeAttributes } from '@tiptap/core'

/**
 * An explicit page break — OOXML `<w:br w:type="page"/>`.
 *
 * MVP renders a continuous page-styled view, so the break shows as a labelled
 * rule rather than starting a real new page; true page-flow layout is post-MVP
 * (CLAUDE.md "Known hard problems"). It is a real node regardless, because the
 * break must survive a DOCX round-trip whether or not we can lay it out.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pageBreak: {
      insertPageBreak: () => ReturnType
    }
  }
}

export const PageBreak = Node.create({
  name: 'pageBreak',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  parseHTML() {
    return [{ tag: 'div[data-page-break]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-page-break': 'true',
        class: 'page-break',
        // Printing is where the break actually takes effect today.
        style: 'break-after: page',
      }),
    ]
  },

  addCommands() {
    return {
      insertPageBreak:
        () =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name })
            // Leave the caret in a paragraph after the break, or the user is
            // stuck on an atom node with nowhere to type.
            .createParagraphNear()
            .focus()
            .run(),
    }
  },
})
