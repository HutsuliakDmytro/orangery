import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import { captionKindOf, numberCaptions, SEQUENCE_NAMES } from '../../ooxml/captions'
import type { CaptionKind, CaptionSource } from '../../ooxml/captions'

/**
 * Captions — "Figure 1.2 — the thing in the picture".
 *
 * The paragraph holds only the description. The label and the number are drawn
 * in front of it, because both are derived: the number from how many captions
 * of that kind come before it, and the label from the kind. Typing either into
 * the text would make it wrong as soon as anything moved.
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    caption: {
      /** Turns the paragraph after the selection into a caption. */
      insertCaption: (kind: CaptionKind) => ReturnType
    }
  }
}

export interface CaptionOptions {
  /** Whether captions count within a chapter, which follows heading numbering. */
  chapters: () => boolean
  /** The word in front of the number, by kind and by the document's language. */
  label: (kind: CaptionKind) => string
}

export const captionKey = new PluginKey<DecorationSet>('captions')

/** Word's own caption style, so the file says what the paragraph is. */
export const CAPTION_STYLE_ID = 'Caption'

function build(state: EditorState, options: CaptionOptions): DecorationSet {
  // Positions are kept beside the blocks, because the counting works on what a
  // block says rather than on where it is.
  const blocks: CaptionSource[] = []
  const positions: number[] = []

  state.doc.forEach((node, position) => {
    const level: unknown = node.attrs['level']
    blocks.push({
      type: node.type.name,
      level: typeof level === 'number' ? level : undefined,
      captionKind: captionKindOf(node.attrs['captionKind']),
    })
    positions.push(position)
  })

  const decorations = numberCaptions(blocks, options.chapters()).map((caption) =>
    Decoration.widget(
      (positions[caption.index] ?? 0) + 1,
      () => {
        const span = document.createElement('span')
        span.className = 'caption-label'
        span.textContent = `${options.label(caption.kind)} ${caption.number} — `
        span.setAttribute('contenteditable', 'false')
        return span
      },
      { side: -1, marks: [] },
    ),
  )

  return DecorationSet.create(state.doc, decorations)
}

export const Caption = Extension.create<CaptionOptions>({
  name: 'caption',

  addOptions() {
    return {
      chapters: () => false,
      label: (kind) => SEQUENCE_NAMES[kind],
    }
  },

  addGlobalAttributes() {
    return [
      {
        types: ['paragraph'],
        attributes: {
          captionKind: {
            default: null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const kind = attributes['captionKind']
              return typeof kind === 'string' ? { 'data-caption': kind } : {}
            },
            parseHTML: (element: HTMLElement) => element.getAttribute('data-caption'),
          },
        },
      },
    ]
  },

  addCommands() {
    return {
      insertCaption:
        (kind) =>
        ({ chain, state }) => {
          // Placed after the block the cursor is in, which is the picture or
          // table being captioned — a caption inside it would be part of it.
          const { $from } = state.selection
          const after = $from.after($from.depth)

          return chain()
            .insertContentAt(after, {
              type: 'paragraph',
              attrs: { captionKind: kind, styleId: CAPTION_STYLE_ID },
            })
            .setTextSelection(after + 1)
            .run()
        },
    }
  },

  addProseMirrorPlugins() {
    const options = this.options

    return [
      new Plugin<DecorationSet>({
        key: captionKey,

        state: {
          init: (_config, state) => build(state, options),
          apply: (transaction, previous, _oldState, newState) =>
            transaction.docChanged ? build(newState, options) : previous,
        },

        props: {
          decorations(state) {
            return captionKey.getState(state)
          },
        },
      }),
    ]
  },
})
