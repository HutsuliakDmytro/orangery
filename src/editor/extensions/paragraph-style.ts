import { Extension } from '@tiptap/core'

/**
 * Named paragraph styles — OOXML `w:pStyle`.
 *
 * Headings are nodes (Tiptap's `heading`), but Title and Subtitle are not
 * headings in Word or Docs: they are paragraph styles applied to a normal
 * paragraph. Modelling them as a `styleId` attribute keeps that distinction, so
 * an imported document round-trips its `w:pStyle` instead of being rewritten
 * into a heading level that was never there.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphStyle: {
      /** Any style the document defines, not only the ones named here. */
      setParagraphStyle: (styleId: string) => ReturnType
      clearParagraphStyle: () => ReturnType
    }
  }
}

/** Word's built-in style ids. Custom styles from an imported file pass through. */
export const NAMED_PARAGRAPH_STYLES = ['Title', 'Subtitle'] as const

export type NamedParagraphStyle = (typeof NAMED_PARAGRAPH_STYLES)[number]

export interface ParagraphStyleOptions {
  types: string[]
}

export const ParagraphStyle = Extension.create<ParagraphStyleOptions>({
  name: 'paragraphStyle',

  addOptions() {
    return { types: ['paragraph'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: {
          styleId: {
            default: null,
            parseHTML: (element: HTMLElement) => element.getAttribute('data-style-id'),
            renderHTML: (attributes: Record<string, unknown>) => {
              const styleId = attributes['styleId']
              if (typeof styleId !== 'string') return {}
              return {
                'data-style-id': styleId,
                class: `doc-style-${styleId.toLowerCase()}`,
              }
            },
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      setParagraphStyle:
        (styleId: string) =>
        ({ chain }) =>
          // A styled paragraph is still a paragraph: drop any heading first so
          // Title applied to an H2 does not leave both markers on the block.
          chain().setParagraph().updateAttributes('paragraph', { styleId }).run(),

      clearParagraphStyle:
        () =>
        ({ commands }) =>
          commands.resetAttributes('paragraph', 'styleId'),
    }
  },
})
