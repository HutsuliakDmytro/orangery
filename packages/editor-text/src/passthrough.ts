import { Mark, Node, mergeAttributes } from '@tiptap/core'

/**
 * Opaque OOXML we do not model.
 *
 * The parser stores the element's serialised XML here and the serialiser writes
 * it back verbatim, so an unsupported construct survives editing elsewhere in
 * the file. This is the mechanism every app's preservation guarantee rests on —
 * see `apps/docs/docs/adr/0003-docx-native-roundtrip.md`, which is written
 * about documents and true of decks for the same reasons.
 *
 * The content is deliberately not editable: we cannot round-trip a modification
 * to XML we do not understand, so pretending otherwise would lose data quietly.
 */

export interface PassthroughAttributes {
  /** Serialised XML of the original element. */
  xml: string
  /** Tag name, shown to the user so the placeholder is not a mystery box. */
  tag: string
}

export const PassthroughBlock = Node.create({
  name: 'passthroughBlock',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      xml: { default: '' },
      tag: { default: 'unknown' },
    }
  },

  parseHTML() {
    return [{ tag: 'div[data-passthrough]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const tag: unknown = node.attrs['tag']

    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-passthrough': 'block',
        class: 'passthrough-block',
        contenteditable: 'false',
        title: `Preserved as-is: <${typeof tag === 'string' ? tag : 'unknown'}>`,
      }),
    ]
  },
})

/**
 * Inline counterpart, for run-level elements inside a paragraph that we do not
 * model (fields, footnote references, embedded objects).
 */
export const PassthroughInline = Node.create({
  name: 'passthroughInline',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,

  addAttributes() {
    return {
      xml: { default: '' },
      tag: { default: 'unknown' },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-passthrough]' }]
  },

  renderHTML({ HTMLAttributes, node }) {
    const tag: unknown = node.attrs['tag']

    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-passthrough': 'inline',
        class: 'passthrough-inline',
        contenteditable: 'false',
        title: `Preserved as-is: <${typeof tag === 'string' ? tag : 'unknown'}>`,
      }),
    ]
  },
})

/**
 * Run properties we parsed but do not model as marks (`w:rPr` children such as
 * `w:effect` or `w:em`). Carried on the text so the run can be rebuilt with its
 * original properties intact.
 */
export const PreservedRunProperties = Mark.create({
  name: 'preservedRunProperties',
  excludes: '',

  addAttributes() {
    return {
      xml: { default: '' },
      /** Identifies the source `w:r`, so run boundaries survive a save. */
      runKey: { default: null },
      /** The original `w:rPr`, written back when nothing modelled changed. */
      rPrOriginal: { default: null },
      rPrSignature: { default: null },
      /**
       * Whether the run's text declared `xml:space="preserve"`.
       *
       * A writer preference rather than a rule: Word writes it where the space
       * would otherwise be dropped, Google Docs writes it on every run, and
       * LibreOffice on some runs and not others. It used to be one flag for the
       * whole document — "every run had it" — which meant a document with the
       * mixed convention lost the attribute from the runs that did not need it,
       * and a conforming reader is then free to drop a space somebody typed.
       *
       * Null for text that did not come from a file, where the serialiser's own
       * rule applies: write it when the text would lose something without it.
       */
      preserveSpace: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-rpr]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-rpr': '' }), 0]
  },
})
