import CharacterCount from '@tiptap/extension-character-count'
import Color from '@tiptap/extension-color'
import FontFamily from '@tiptap/extension-font-family'
import Highlight from '@tiptap/extension-highlight'
import Link from '@tiptap/extension-link'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import Table from '@tiptap/extension-table'
import TableCell from '@tiptap/extension-table-cell'
import TableHeader from '@tiptap/extension-table-header'
import TableRow from '@tiptap/extension-table-row'
import TaskItem from '@tiptap/extension-task-item'
import TaskList from '@tiptap/extension-task-list'
import TextAlign from '@tiptap/extension-text-align'
import TextStyle from '@tiptap/extension-text-style'
import Underline from '@tiptap/extension-underline'
import StarterKit from '@tiptap/starter-kit'
import type { Editor, Extensions } from '@tiptap/core'
import { useSettingsStore } from '../store/settings-store'
import { useViewStore } from '../store/view-store'
import { CommandKeymap } from '@orangery/ui-kit'
import { FindReplace } from './extensions/find-replace'
import { Footnote } from './extensions/footnote'
import { Caption } from './extensions/caption'
import { CharacterStyle } from './extensions/character-style'
import { CommentMark } from './extensions/comment'
import { Deletion, FormatChange, Insertion, Revisions } from './extensions/revisions'
import { TrackChanges } from './extensions/track-changes'
import { DocumentImage } from './extensions/document-image'
import {
  FontSize,
  Indent,
  ParagraphSpacing,
  PassthroughBlock,
  PassthroughInline,
  PastePlainText,
  PreservedRunProperties,
  SmartTyping,
  TabIndent,
} from '@orangery/editor-text'
import { HeadingNumbering } from './extensions/heading-numbering'
import { ImageDrop } from './extensions/image-drop'
import { PageBreak } from './extensions/page-break'
import { SectionBreak } from './extensions/section-break'
import { PageGaps } from './extensions/page-gaps'
import { Pagination } from './extensions/pagination'
import { ParagraphStyle } from './extensions/paragraph-style'
import { TableOfContents } from './extensions/table-of-contents'
import { TabRendering } from './extensions/tab-rendering'
import { TabStops } from './extensions/tab-stops'

/**
 * The editor's extension set, in one place.
 *
 * Tests run against the same list as the app: a separate list in the test
 * harness drifts, and then a command passes its test while failing in the
 * product — or the reverse, which is worse because it looks like a real bug.
 */
/**
 * The editor handling a paste needs to reach the insert action, which needs the
 * editor. The instance is recorded here rather than threaded through, because
 * the extension list is built before the editor exists.
 */
let currentEditor: Editor | null = null

export function setCurrentEditor(editor: Editor | null): void {
  currentEditor = editor
}

export function buildExtensions(): Extensions {
  return [
    StarterKit.configure({
      // Typing runs together into one undo step instead of one per character;
      // 500 ms is ProseMirror's own default and what Word feels like.
      history: { newGroupDelay: 500 },
    }),
    Underline,
    Superscript,
    Subscript,
    // TextStyle carries colour, family and size as attributes of one mark,
    // which maps onto OOXML run properties (`w:rPr`) rather than nested spans.
    TextStyle,
    Color,
    FontFamily,
    FontSize,
    Highlight.configure({ multicolor: true }),
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    TaskList,
    TaskItem.configure({ nested: true }),
    ParagraphStyle,
    CharacterStyle,
    CommentMark,
    Insertion,
    Deletion,
    FormatChange,
    Revisions,
    TrackChanges.configure({
      enabled: () => useViewStore.getState().trackChanges,
      author: () => useSettingsStore.getState().authorName,
    }),
    ParagraphSpacing,
    Indent,
    Caption.configure({
      // Captions count within a chapter exactly when the chapters are numbered:
      // "Figure 1.2" means nothing in a document whose chapters have no numbers.
      chapters: () => useViewStore.getState().headingNumbering !== null,
    }),
    HeadingNumbering.configure({
      scheme: () => useViewStore.getState().headingNumbering,
    }),
    PageBreak,
    SectionBreak,
    PageGaps,
    Pagination,
    TabIndent,
    TabStops,
    TabRendering,
    Table.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          grid: { default: null },
          tblGrid: { default: null },
          tblGridColumns: { default: null },
          tblPr: { default: null },
          preserved: { default: null },
          /** Border set, pulled out of `w:tblPr` so it can be rendered. */
          borders: {
            default: null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const borders = attributes['borders']
              if (typeof borders !== 'object' || borders === null) return {}

              const set = borders as Record<
                string,
                { style: string; width: number; color: string | null }
              >
              const edge = (name: string) => {
                const border = set[name]
                if (!border || border.style === 'none') return 'none'
                const style =
                  border.style === 'double'
                    ? 'double'
                    : border.style === 'dashed'
                      ? 'dashed'
                      : border.style === 'dotted'
                        ? 'dotted'
                        : 'solid'
                const width = border.style === 'thick' ? Math.max(border.width, 1.5) : border.width
                return `${String(width)}pt ${style} ${border.color ?? '#000000'}`
              }

              return {
                style: [
                  `border-top: ${edge('top')}`,
                  `border-right: ${edge('right')}`,
                  `border-bottom: ${edge('bottom')}`,
                  `border-left: ${edge('left')}`,
                  // Inside borders are drawn by the cells, which read them from
                  // a custom property rather than each carrying a copy.
                  `--cell-border-h: ${edge('insideH')}`,
                  `--cell-border-v: ${edge('insideV')}`,
                ].join('; '),
              }
            },
          },
        }
      },
    }).configure({
      // Word tables are grid-based, so a fixed column layout matches the model
      // and makes the drag handles behave the way they do in Word.
      resizable: true,
      lastColumnResizable: false,
      cellMinWidth: 24,
    }),
    // Row properties we preserve rather than model — height, header repeat.
    TableRow.extend({
      addAttributes() {
        return { ...this.parent?.(), trPr: { default: null } }
      },
    }),
    TableHeader,
    // Extra attributes so the OOXML properties we preserve survive an edit.
    TableCell.extend({
      addAttributes() {
        return {
          ...this.parent?.(),
          background: {
            default: null,
            parseHTML: (element: HTMLElement) => element.style.backgroundColor || null,
            renderHTML: (attributes: Record<string, unknown>) => {
              const background = attributes['background']
              return typeof background === 'string'
                ? { style: `background-color: ${background}` }
                : {}
            },
          },
          tcPr: { default: null },
          tcPrColspan: { default: null },
          tcPrRowspan: { default: null },
          mergedCells: { default: null },
        }
      },
    }),
    DocumentImage,
    ImageDrop.configure({
      onFiles: (files) => {
        // Imported lazily: the actions module reaches into the document session,
        // which must not be pulled into the editor's own dependency graph.
        void import('./commands/image-actions').then(({ imageActions }) => {
          const instance = currentEditor
          if (instance) void imageActions.insertFiles(instance, files)
        })
      },
    }),
    Footnote,
    TableOfContents.configure({
      scheme: () => useViewStore.getState().headingNumbering,
    }),
    PassthroughBlock,
    PassthroughInline,
    PreservedRunProperties,
    Link.configure({
      openOnClick: false,
      autolink: true,
      linkOnPaste: true,
      // Only schemes `normalizeUrl` accepts; anything else is dropped on paste.
      protocols: ['http', 'https', 'mailto', 'tel'],
      HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
    }),
    CharacterCount,
    FindReplace,
    SmartTyping.configure({
      // Read through the store rather than captured: the extension list is
      // built once, and the setting can change at any time after that.
      enabled: () => useSettingsStore.getState().smartTyping,
      fallbackLanguage: () => useSettingsStore.getState().language,
    }),
    PastePlainText,
    // The registry does not know what a command acts on; in this app it is the
    // editor the keystroke arrived in.
    CommandKeymap.configure({ context: (instance) => ({ editor: instance }) }),
  ]
}
