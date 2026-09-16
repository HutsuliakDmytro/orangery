import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorState } from '@tiptap/pm/state'
import { headingNumbers } from '../heading-numbers'
import type { HeadingNumberScheme } from '../heading-numbers'

/**
 * Draws the number in front of each heading.
 *
 * A widget decoration rather than text in the document: the number is derived
 * from where the heading sits, so it has to change when the heading moves, and
 * text in the document would have to be renumbered by hand — which is the
 * problem numbering is meant to solve.
 *
 * The same computation feeds the table of contents, so what a heading is called
 * there and what it is called on the page cannot drift apart.
 */

export const headingNumberingKey = new PluginKey<NumberingState>('headingNumbering')

interface NumberingState {
  scheme: HeadingNumberScheme | null
  decorations: DecorationSet
}

export interface HeadingNumberingOptions {
  /** Read on every change, so switching schemes takes effect at once. */
  scheme: () => HeadingNumberScheme | null
}

function build(state: EditorState, scheme: HeadingNumberScheme | null): DecorationSet {
  if (scheme === null) return DecorationSet.empty

  const decorations = headingNumbers(state.doc, scheme).map((number) =>
    Decoration.widget(
      // Inside the heading, in front of its text, so the number sits on the
      // same line and inherits the heading's own formatting.
      number.position + 1,
      () => {
        const span = document.createElement('span')
        span.className = 'heading-number'
        span.textContent = number.label
        // Not part of the text: excluded from selection, copying and find.
        span.setAttribute('contenteditable', 'false')
        return span
      },
      { side: -1, marks: [] },
    ),
  )

  return DecorationSet.create(state.doc, decorations)
}

export const HeadingNumbering = Extension.create<HeadingNumberingOptions>({
  name: 'headingNumbering',

  addOptions() {
    return { scheme: () => null }
  },

  addProseMirrorPlugins() {
    const { scheme } = this.options

    return [
      new Plugin<NumberingState>({
        key: headingNumberingKey,

        state: {
          init(_config, state) {
            const current = scheme()
            return { scheme: current, decorations: build(state, current) }
          },

          apply(transaction, previous, _oldState, newState) {
            const current = scheme()

            // Numbers follow the structure, so they only change when the
            // document does — or when the scheme itself is switched.
            if (!transaction.docChanged && current === previous.scheme) return previous

            return { scheme: current, decorations: build(newState, current) }
          },
        },

        props: {
          decorations(state) {
            return headingNumberingKey.getState(state)?.decorations ?? DecorationSet.empty
          },
        },
      }),
    ]
  },
})
