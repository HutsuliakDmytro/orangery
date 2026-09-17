import { Mark, mergeAttributes } from '@tiptap/core'

/**
 * A character style — `w:rStyle`.
 *
 * Word has two kinds of style: one for the paragraph and one for a run of text
 * inside it. The second is how "Emphasis", "Strong" or "Book Title" are applied
 * without stating what they look like, so that changing the style changes every
 * run wearing it.
 *
 * Held as a mark of its own rather than as an attribute of the text style: it
 * names formatting instead of describing it, and clearing the formatting on a
 * run should not silently rename what that run *is*.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    characterStyle: {
      setCharacterStyle: (styleId: string) => ReturnType
      unsetCharacterStyle: () => ReturnType
    }
  }
}

export const CharacterStyle = Mark.create({
  name: 'characterStyle',

  addAttributes() {
    return {
      styleId: {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-style-id'),
        renderHTML: (attributes: Record<string, unknown>) => {
          const styleId = attributes['styleId']
          return typeof styleId === 'string' ? { 'data-style-id': styleId } : {}
        },
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-style-id]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'character-style' }), 0]
  },

  addCommands() {
    return {
      setCharacterStyle:
        (styleId) =>
        ({ commands }) =>
          commands.setMark(this.name, { styleId }),

      unsetCharacterStyle:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    }
  },
})
