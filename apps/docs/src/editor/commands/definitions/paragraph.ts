import { HEADING_NUMBER_SCHEMES } from '../../heading-numbers'
import type { HeadingNumberScheme } from '../../heading-numbers'
import { PAGINATION_ATTRIBUTES } from '../../extensions/pagination'
import type { PaginationAttribute } from '../../extensions/pagination'
import type { Editor } from '@tiptap/core'
import { useViewStore } from '../../../store/view-store'
import { requestPicker } from '../picker-store'
import { normalizeBlockSelection } from '../selection'
import type { Command } from '@orangery/ui-kit'

/** Mirrors Tiptap's `Level`; declared locally so the heading package stays transitive. */
type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6

const HEADING_LEVELS: readonly HeadingLevel[] = [1, 2, 3, 4, 5, 6]

/** Paragraph styles, laid out like the style dropdown in Google Docs. */
const styles: readonly Command[] = [
  {
    id: 'paragraph.normal',
    label: 'Normal Text',
    group: 'format',
    shortcut: 'Mod+Alt+0',
    keywords: ['body', 'default', 'plain'],
    run: ({ editor }) => {
      editor.chain().focus().setParagraph().clearParagraphStyle().run()
    },
    isActive: ({ editor }) =>
      editor.isActive('paragraph') && !editor.getAttributes('paragraph')['styleId'],
  },
  {
    id: 'paragraph.title',
    label: 'Title',
    group: 'format',
    keywords: ['document title'],
    run: ({ editor }) => {
      editor.chain().focus().setParagraphStyle('Title').run()
    },
    isActive: ({ editor }) => editor.getAttributes('paragraph')['styleId'] === 'Title',
  },
  {
    id: 'paragraph.subtitle',
    label: 'Subtitle',
    group: 'format',
    keywords: ['secondary title'],
    run: ({ editor }) => {
      editor.chain().focus().setParagraphStyle('Subtitle').run()
    },
    isActive: ({ editor }) => editor.getAttributes('paragraph')['styleId'] === 'Subtitle',
  },
  ...HEADING_LEVELS.map((level): Command => ({
    id: `paragraph.heading-${String(level)}`,
    label: `Heading ${String(level)}`,
    group: 'format',
    shortcut: `Mod+Alt+${String(level)}`,
    keywords: [`h${String(level)}`],
    run: ({ editor }) => {
      editor.chain().focus().toggleHeading({ level }).run()
    },
    isActive: ({ editor }) => editor.isActive('heading', { level }),
    isEnabled: ({ editor }) => editor.can().chain().toggleHeading({ level }).run(),
  })),
]

const ALIGNMENTS = [
  { value: 'left', label: 'Align Left', shortcut: 'Mod+Shift+l' },
  { value: 'center', label: 'Center', shortcut: 'Mod+Shift+e' },
  { value: 'right', label: 'Align Right', shortcut: 'Mod+Shift+r' },
  { value: 'justify', label: 'Justify', shortcut: 'Mod+Shift+j' },
] as const

const alignment: readonly Command[] = ALIGNMENTS.map(({ value, label, shortcut }) => ({
  id: `paragraph.align-${value}`,
  label,
  group: 'format',
  shortcut,
  keywords: ['alignment', value],
  run: ({ editor }) => {
    editor.chain().focus().setTextAlign(value).run()
  },
  isActive: ({ editor }) => editor.isActive({ textAlign: value }),
}))

const spacing: readonly Command[] = [
  {
    id: 'paragraph.line-spacing',
    label: 'Line Spacing…',
    group: 'format',
    keywords: ['leading', 'single', 'double'],
    run: () => {
      requestPicker('line-spacing')
    },
  },
]

const indentation: readonly Command[] = [
  {
    id: 'paragraph.indent',
    label: 'Increase Indent',
    group: 'format',
    shortcut: 'Mod+]',
    keywords: ['right', 'tab'],
    run: ({ editor }) => {
      // Inside a list this means one level deeper, not a wider margin.
      if (editor.can().sinkListItem('listItem')) {
        editor.chain().focus().sinkListItem('listItem').run()
        return
      }
      if (editor.can().sinkListItem('taskItem')) {
        editor.chain().focus().sinkListItem('taskItem').run()
        return
      }
      editor.chain().focus().indent().run()
    },
  },
  {
    id: 'paragraph.outdent',
    label: 'Decrease Indent',
    group: 'format',
    shortcut: 'Mod+[',
    keywords: ['left', 'untab'],
    run: ({ editor }) => {
      if (editor.can().liftListItem('listItem')) {
        editor.chain().focus().liftListItem('listItem').run()
        return
      }
      if (editor.can().liftListItem('taskItem')) {
        editor.chain().focus().liftListItem('taskItem').run()
        return
      }
      editor.chain().focus().outdent().run()
    },
  },
]

/**
 * List toggles carry no `isEnabled`: Tiptap's `can().toggleOrderedList()` reports
 * false whenever the cursor is already inside a list of another type, even though
 * the command itself converts the list correctly. Gating on it would grey out the
 * exact action the user wants — turning a bulleted list into a numbered one.
 */
const lists: readonly Command[] = [
  {
    id: 'paragraph.bullet-list',
    label: 'Bulleted List',
    group: 'format',
    shortcut: 'Mod+Shift+8',
    keywords: ['unordered', 'bullets'],
    run: ({ editor }) => {
      normalizeBlockSelection(editor)
      editor.chain().focus().toggleBulletList().run()
    },
    isActive: ({ editor }) => editor.isActive('bulletList'),
  },
  {
    id: 'paragraph.ordered-list',
    label: 'Numbered List',
    group: 'format',
    shortcut: 'Mod+Shift+7',
    keywords: ['ordered', 'numbers'],
    run: ({ editor }) => {
      normalizeBlockSelection(editor)
      editor.chain().focus().toggleOrderedList().run()
    },
    isActive: ({ editor }) => editor.isActive('orderedList'),
  },
  {
    id: 'paragraph.task-list',
    label: 'Checklist',
    group: 'format',
    shortcut: 'Mod+Shift+9',
    keywords: ['todo', 'checkbox', 'tasks'],
    run: ({ editor }) => {
      normalizeBlockSelection(editor)
      editor.chain().focus().toggleTaskList().run()
    },
    isActive: ({ editor }) => editor.isActive('taskList'),
  },
]

const blocks: readonly Command[] = [
  {
    id: 'insert.blockquote',
    label: 'Block Quote',
    group: 'insert',
    keywords: ['quote', 'citation'],
    run: ({ editor }) => {
      normalizeBlockSelection(editor)
      editor.chain().focus().toggleBlockquote().run()
    },
    isActive: ({ editor }) => editor.isActive('blockquote'),
    isEnabled: ({ editor }) => editor.can().chain().toggleBlockquote().run(),
  },
  {
    id: 'insert.horizontal-rule',
    label: 'Horizontal Line',
    group: 'insert',
    keywords: ['divider', 'rule', 'separator'],
    run: ({ editor }) => {
      editor.chain().focus().setHorizontalRule().run()
    },
  },
  {
    id: 'insert.page-break',
    label: 'Page Break',
    group: 'insert',
    shortcut: 'Mod+Enter',
    keywords: ['new page'],
    run: ({ editor }) => {
      editor.chain().focus().insertPageBreak().run()
    },
  },
]

/**
 * How the paragraph behaves at a page break.
 *
 * Written down even when it matches Word's default, because "not specified" and
 * "off" are different documents — `widowControl` is on unless a paragraph says
 * otherwise.
 */
const PAGINATION_LABELS: Readonly<
  Record<PaginationAttribute, { label: string; keywords: string[] }>
> = {
  keepNext: { label: 'Keep with Next Paragraph', keywords: ['together', 'orphan', 'heading'] },
  keepLines: { label: 'Keep Lines Together', keywords: ['split', 'break', 'paragraph'] },
  pageBreakBefore: { label: 'Page Break Before', keywords: ['new page', 'start'] },
  widowControl: { label: 'Widow and Orphan Control', keywords: ['single line', 'dangling'] },
}

const pagination: readonly Command[] = PAGINATION_ATTRIBUTES.map((name) => ({
  id: `paragraph.${name.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`)}`,
  label: PAGINATION_LABELS[name].label,
  group: 'format' as const,
  keywords: PAGINATION_LABELS[name].keywords,
  run: ({ editor }) => {
    editor.chain().focus().togglePagination(name).run()
  },
  isActive: ({ editor }) =>
    editor.getAttributes('paragraph')[name] === true ||
    editor.getAttributes('heading')[name] === true,
}))

/**
 * Numbering the headings, as one command per scheme plus one to stop.
 *
 * A property of the document, so it is held beside the page setup rather than
 * on the paragraphs: every heading of a level is numbered by the same
 * definition, which is also how Word writes it into the file.
 */
/**
 * Nudges the editor so the numbers are redrawn.
 *
 * The scheme lives in a store, and the plugin that draws the numbers only looks
 * at it when a transaction goes past. An empty one changes no content, so the
 * document is not marked unsaved by a change of scheme.
 */
function redrawNumbers(editor: Editor): void {
  editor.view.dispatch(editor.state.tr)
}

const SCHEME_LABELS: Readonly<Record<HeadingNumberScheme, string>> = {
  decimal: 'Number Headings 1, 1.1, 1.1.1',
  outline: 'Number Headings I, A, 1',
}

const numbering: readonly Command[] = [
  ...HEADING_NUMBER_SCHEMES.map((scheme): Command => ({
    id: `paragraph.heading-numbers-${scheme}`,
    label: SCHEME_LABELS[scheme],
    group: 'format',
    keywords: ['multilevel', 'outline', 'chapter', 'section'],
    run: ({ editor }) => {
      const { headingNumbering, setHeadingNumbering } = useViewStore.getState()
      // Running the scheme that is already on turns numbering off, so the
      // command behaves like the toggle its tick in the menu says it is.
      setHeadingNumbering(headingNumbering === scheme ? null : scheme)
      redrawNumbers(editor)
    },
    isActive: () => useViewStore.getState().headingNumbering === scheme,
  })),
  {
    id: 'paragraph.heading-numbers-none',
    label: 'No Heading Numbers',
    group: 'format',
    keywords: ['unnumbered', 'plain'],
    run: ({ editor }) => {
      useViewStore.getState().setHeadingNumbering(null)
      redrawNumbers(editor)
    },
    isActive: () => useViewStore.getState().headingNumbering === null,
  },
]

export const paragraphCommands: readonly Command[] = [
  ...styles,
  ...alignment,
  ...spacing,
  ...indentation,
  ...lists,
  ...blocks,
  ...pagination,
  ...numbering,
]
