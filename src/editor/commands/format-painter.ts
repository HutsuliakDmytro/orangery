import type { Editor } from '@tiptap/core'
import type { Mark } from '@tiptap/pm/model'
import { PAGINATION_ATTRIBUTES } from '../extensions/pagination'

/**
 * Copying formatting from one place to another.
 *
 * Word calls it the format painter. What travels is how the text and the
 * paragraph look, not what they are: the block type stays put, because turning
 * a paragraph into a heading is a change of structure and nobody expects a
 * brush to do that.
 */

/** Marks that are not formatting and must not be painted onto other text. */
const NOT_FORMATTING = new Set([
  // Carries the source run's identity and its preserved `w:rPr`. Painting it
  // would give two different runs the same preserved markup.
  'preservedRunProperties',
  // A hyperlink is content, not an appearance; Word does not paint it either.
  'link',
])

/** Paragraph attributes the brush carries, named as the editor stores them. */
const BLOCK_ATTRIBUTES = [
  'textAlign',
  'lineHeight',
  'spaceBefore',
  'spaceAfter',
  'indentLeft',
  'indentRight',
  'indentFirstLine',
  ...PAGINATION_ATTRIBUTES,
] as const

export interface CopiedFormat {
  marks: { type: string; attrs: Record<string, unknown> }[]
  block: Record<string, unknown>
}

let held: CopiedFormat | null = null

export function heldFormat(): CopiedFormat | null {
  return held
}

export function clearFormat(): void {
  held = null
}

/** The marks in force where the cursor is, or at the start of the selection. */
function marksAt(editor: Editor): readonly Mark[] {
  const { state } = editor
  const { empty, $from } = state.selection

  if (empty) return state.storedMarks ?? $from.marks()

  // At a selection's start the position may sit just outside the first text
  // node, whose marks are the ones a user means by "this formatting".
  const first = $from.nodeAfter
  return first?.marks ?? $from.marks()
}

export function copyFormat(editor: Editor): CopiedFormat {
  const { state } = editor
  const block = state.selection.$from.parent

  const attrs: Record<string, unknown> = {}
  for (const name of BLOCK_ATTRIBUTES) {
    if (block.attrs[name] !== undefined) attrs[name] = block.attrs[name]
  }

  held = {
    marks: marksAt(editor)
      .filter((mark) => !NOT_FORMATTING.has(mark.type.name))
      .map((mark) => ({ type: mark.type.name, attrs: { ...mark.attrs } })),
    block: attrs,
  }

  // Nothing about the document changed, but what is held is module state, and
  // the toolbar only re-reads on a transaction. An empty one changes no
  // content, so it does not mark the document unsaved either.
  editor.view.dispatch(state.tr)

  return held
}

/** Applies the held formatting to the selection. */
export function applyFormat(editor: Editor): boolean {
  const format = held
  if (format === null) return false

  return editor
    .chain()
    .focus()
    .command(({ tr, state, dispatch }) => {
      const { from, to, empty } = state.selection

      const created = format.marks
        .map((mark) => state.schema.marks[mark.type]?.create(mark.attrs))
        .filter((mark): mark is Mark => mark !== undefined)

      if (empty) {
        // Nothing selected: the formatting becomes what the next characters
        // typed will carry, which is what a brush clicked into empty text does.
        tr.setStoredMarks(created)
      } else {
        // Only the formatting marks are cleared. Stripping everything would
        // take the preserved run properties of the text painted over with it.
        for (const name of Object.keys(state.schema.marks)) {
          if (NOT_FORMATTING.has(name)) continue
          const type = state.schema.marks[name]
          if (type) tr.removeMark(from, to, type)
        }

        for (const mark of created) tr.addMark(from, to, mark)
      }

      // Mark steps leave positions alone, so the ones read from the document
      // before them are still where these blocks are.
      state.doc.nodesBetween(from, to, (node, position) => {
        if (node.type.name !== 'paragraph' && node.type.name !== 'heading') return true
        tr.setNodeMarkup(position, undefined, { ...node.attrs, ...format.block })
        return false
      })

      dispatch?.(tr)
      return true
    })
    .run()
}
