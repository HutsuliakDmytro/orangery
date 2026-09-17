import { Node, mergeAttributes } from '@tiptap/core'
import { DEFAULT_SECTION, serializeSection } from '../../ooxml/section'
import type { SectionProperties } from '../../ooxml/section'

/**
 * A section break.
 *
 * OOXML keeps a section's page setup on the last paragraph of that section, so
 * a break is not an element in the file — it is where one paragraph's
 * properties say the page changes. Shown here as a block of its own, because a
 * break the user cannot see is one they cannot move or remove, and the page
 * setup either side of it is the thing they came to change.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    sectionBreak: {
      /** Ends the section at the cursor, starting a new one after it. */
      insertSectionBreak: (section?: SectionProperties) => ReturnType
    }
  }
}

export const SectionBreak = Node.create({
  name: 'sectionBreak',
  group: 'block',
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      /**
       * The whole `w:sectPr` of the section that ends here.
       *
       * Held as markup rather than as parsed properties: a section carries
       * headers, footnote settings and column layout this app does not model,
       * and rebuilding it from what it does model would drop the rest.
       */
      sectPr: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-section-break]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-section-break': 'true',
        class: 'section-break',
      }),
      ['span', { class: 'section-break-label' }, 'Section break'],
    ]
  },

  addCommands() {
    return {
      insertSectionBreak:
        (section) =>
        ({ chain, state }) => {
          const { $from } = state.selection
          const after = $from.after($from.depth)

          const breakNode = {
            type: this.name,
            // The section that *ends* here keeps the setup the document has
            // now; the one starting after it is the one the user will change.
            attrs: { sectPr: serializeSection(section ?? { ...EMPTY_SECTION }) },
          }

          // A break at the very end starts a section with nothing in it, and an
          // atom is not somewhere a caret can go — so the new section gets a
          // paragraph to type into, which is what Word leaves behind too.
          const atEnd = after >= state.doc.content.size
          const content = atEnd ? [breakNode, { type: 'paragraph' }] : [breakNode]

          return chain()
            .insertContentAt(after, content)
            .setTextSelection(after + 2)
            .run()
        },
    }
  },
})

/**
 * Page setup for a break inserted with nothing to copy from.
 *
 * The document's own defaults, rather than a second copy of them: a copy drifts
 * the moment either is changed.
 */
const EMPTY_SECTION: SectionProperties = {
  ...DEFAULT_SECTION,
  margins: { ...DEFAULT_SECTION.margins },
}
