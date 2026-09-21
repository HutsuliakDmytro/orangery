import { Extension } from '@tiptap/core'

/**
 * What an OOXML paragraph carries besides its text.
 *
 * A paragraph in either format states more than ProseMirror's own does: an
 * outline level, an alignment, and the properties element it was read from.
 * Without these on the schema the editor drops them on the first keystroke —
 * silently, because a schema simply ignores attributes it was not told about.
 *
 * `pPrOriginal` and `endParaRPr` are carried rather than modelled: they hold
 * the bullet, the spacing and everything else this editor has no opinion on,
 * and they go back to the file as they came.
 */
export const OoxmlParagraph = Extension.create({
  name: 'ooxmlParagraph',

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          /** 0 to 8. The outline depth every list style is keyed by. */
          level: {
            default: 0,
            parseHTML: (element) => Number(element.dataset['level'] ?? 0),
            renderHTML: (attributes) => {
              const level = Number(attributes['level'] ?? 0)
              return level === 0 ? {} : { 'data-level': String(level) }
            },
          },
          /** `l`, `ctr`, `r`, `just`, `dist`, as the file spells it. */
          align: {
            default: null,
            parseHTML: (element) => element.dataset['align'] ?? null,
            renderHTML: (attributes) =>
              attributes['align'] == null ? {} : { 'data-align': String(attributes['align']) },
          },
          /**
           * `character`, `number`, `none`, `picture`, or `inherit`.
           *
           * Null and `inherit` are not the same as `none`: a paragraph that
           * says nothing takes the bullet of its outline level, while one that
           * says `none` has decided it has none.
           */
          bullet: {
            default: null,
            parseHTML: (element) => element.dataset['bullet'] ?? null,
            renderHTML: (attributes) =>
              attributes['bullet'] == null ? {} : { 'data-bullet': String(attributes['bullet']) },
          },
          /** Line spacing as a multiple of the line, or null to inherit it. */
          lineSpacing: {
            default: null,
            parseHTML: (element) => {
              const value = Number(element.dataset['lineSpacing'])
              return Number.isFinite(value) ? value : null
            },
            renderHTML: (attributes) =>
              typeof attributes['lineSpacing'] === 'number'
                ? { 'data-line-spacing': String(attributes['lineSpacing']) }
                : {},
          },
          /**
           * How far the paragraph is pushed in, in EMU, or null to inherit.
           *
           * Null and zero are different answers: null takes the indent of the
           * outline level, and zero says there is none. A schema that defaulted
           * to zero would turn every paragraph nobody touched into one that had
           * decided to sit flush left.
           */
          marginLeft: {
            default: null,
            parseHTML: (element) => {
              const value = Number(element.dataset['marginLeft'])
              return Number.isFinite(value) ? value : null
            },
            renderHTML: (attributes) =>
              typeof attributes['marginLeft'] === 'number'
                ? { 'data-margin-left': String(attributes['marginLeft']) }
                : {},
          },
          /** How much further the first line goes, in EMU; negative hangs it. */
          firstLine: {
            default: null,
            parseHTML: (element) => {
              const value = Number(element.dataset['firstLine'])
              return Number.isFinite(value) ? value : null
            },
            renderHTML: (attributes) =>
              typeof attributes['firstLine'] === 'number'
                ? { 'data-first-line': String(attributes['firstLine']) }
                : {},
          },
          /** The original properties element, serialised. Never rendered. */
          pPrOriginal: { default: null, renderHTML: () => ({}) },
          /** What an empty paragraph would type in. Never rendered. */
          endParaRPr: { default: null, renderHTML: () => ({}) },
        },
      },
    ]
  },
})
