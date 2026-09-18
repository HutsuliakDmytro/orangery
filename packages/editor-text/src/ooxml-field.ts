import { Node, mergeAttributes } from '@tiptap/core'

/**
 * A field: text the file does not know, held by something that does.
 *
 * `a:fld` states a type — the slide's number, today's date — and the answer
 * whatever last saved the file happened to write. Reading it as plain text
 * makes the editor silently destroy it: one keystroke in a footer and the
 * number that followed the slide becomes the digit it happened to show.
 *
 * So it is one thing, not a string of characters. The whole element rides along
 * as XML and is written back untouched, which is the same bargain the
 * passthrough nodes make — the difference is that this one knows what it says,
 * so it can be shown rather than drawn as an empty box.
 */

export interface FieldAttributes {
  /** Serialised `a:fld`, written back exactly as it came. */
  xml: string
  /** `slidenum`, `datetime1`, … What the field stands for. */
  fieldType: string | null
  /** What it says right now, worked out by whoever built the document. */
  text: string
}

export const OoxmlField = Node.create({
  name: 'ooxmlField',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      xml: { default: '' },
      fieldType: { default: null },
      text: { default: '' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-field]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const type: unknown = node.attrs['fieldType']
    const text: unknown = node.attrs['text']

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-field': typeof type === 'string' ? type : 'unknown',
        class: 'ooxml-field',
        // Selectable and deletable, but not typeable-into: half a field is not
        // a field, and there is no way back from one.
        contenteditable: 'false',
        title:
          typeof type === 'string' ? `Updates automatically: ${type}` : 'Updates automatically',
      }),
      typeof text === 'string' ? text : '',
    ]
  },
})
