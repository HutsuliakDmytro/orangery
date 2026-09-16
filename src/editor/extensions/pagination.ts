import { Extension } from '@tiptap/core'

/**
 * How a paragraph behaves at a page break.
 *
 * Four toggles Word keeps in `w:pPr`. Three of them — keeping a paragraph with
 * the next one, keeping its lines together, and widow control — only show
 * themselves in a real page-flow layout, which this editor does not have
 * (CLAUDE.md, "Known hard problems"). They are modelled anyway: a document that
 * declares them is laid out by them in Word and in print, and dropping them on
 * save is a silent change to how the file comes out on paper.
 *
 * "Page break before" is the one that does show here — `PageGaps` reads it and
 * starts a new sheet at that paragraph.
 */

export const PAGINATION_ATTRIBUTES = [
  'keepNext',
  'keepLines',
  'pageBreakBefore',
  'widowControl',
] as const

export type PaginationAttribute = (typeof PAGINATION_ATTRIBUTES)[number]

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    pagination: {
      /** Turns a pagination toggle on or off across the selection. */
      setPagination: (name: PaginationAttribute, value: boolean | null) => ReturnType
      togglePagination: (name: PaginationAttribute) => ReturnType
    }
  }
}

export interface PaginationOptions {
  types: string[]
}

export const Pagination = Extension.create<PaginationOptions>({
  name: 'pagination',

  addOptions() {
    return { types: ['paragraph', 'heading'] }
  },

  addGlobalAttributes() {
    return [
      {
        types: this.options.types,
        attributes: Object.fromEntries(
          PAGINATION_ATTRIBUTES.map((name) => [
            name,
            {
              default: null,
              // Nothing in the DOM stands for these, and a stray data attribute
              // on every paragraph would be noise in copied HTML.
              renderHTML: () => ({}),
              parseHTML: () => null,
            },
          ]),
        ),
      },
    ]
  },

  addCommands() {
    return {
      setPagination:
        (name, value) =>
        ({ commands, editor }) =>
          this.options.types.every((type) =>
            // A selection can span a heading and a paragraph; both take it, and
            // a type the selection does not touch reports no change.
            editor.isActive(type) ? commands.updateAttributes(type, { [name]: value }) : true,
          ),

      togglePagination:
        (name) =>
        ({ editor, commands }) => {
          const current = this.options.types
            .map((type): unknown =>
              editor.isActive(type) ? editor.getAttributes(type)[name] : undefined,
            )
            .find((value) => value !== undefined)

          // Off is written down rather than cleared: `widowControl` is on by
          // default, so "not specified" and "off" are different documents.
          return commands.setPagination(name, current === true ? false : true)
        },
    }
  },
})
