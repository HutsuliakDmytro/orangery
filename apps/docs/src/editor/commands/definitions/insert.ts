import { useCommentsStore } from '../../../store/comments-store'
import { useSettingsStore } from '../../../store/settings-store'
import { useViewStore } from '../../../store/view-store'
import { requestPicker } from '../picker-store'
import type { Command } from '../types'

export const insertCommands: readonly Command[] = [
  {
    id: 'insert.footnote',
    label: 'Footnote',
    group: 'insert',
    shortcut: 'Mod+Alt+f',
    keywords: ['note', 'reference', 'citation'],
    run: ({ editor }) => {
      editor.chain().focus().insertFootnote().run()
    },
  },
  {
    id: 'insert.remove-footnote',
    label: 'Remove Footnote',
    group: 'insert',
    keywords: ['delete note'],
    run: ({ editor }) => {
      editor.chain().focus().removeFootnote().run()
    },
    isEnabled: ({ editor }) => editor.isActive('footnote'),
  },
  {
    id: 'insert.table-of-contents',
    label: 'Table of Contents',
    group: 'insert',
    keywords: ['toc', 'contents', 'index'],
    run: ({ editor }) => {
      editor.chain().focus().insertTableOfContents().refreshTableOfContents().run()
    },
  },
  {
    id: 'insert.comment',
    label: 'Comment',
    group: 'insert',
    shortcut: 'Mod+Alt+m',
    keywords: ['note', 'review', 'remark'],
    run: ({ editor }) => {
      const author = useSettingsStore.getState().authorName
      const id = useCommentsStore.getState().add(author, '')

      editor.chain().focus().setComment(id).run()
    },
    // A comment is about a stretch of text, so there has to be one selected.
    isEnabled: ({ editor }) => !editor.state.selection.empty,
  },
  {
    id: 'insert.section-break',
    label: 'Section Break',
    group: 'insert',
    keywords: ['section', 'landscape', 'margins', 'orientation'],
    run: ({ editor }) => {
      editor.chain().focus().insertSectionBreak(useViewStore.getState().section).run()
    },
  },
  {
    id: 'insert.table-of-figures',
    label: 'List of Figures',
    group: 'insert',
    keywords: ['figures', 'illustrations', 'captions', 'index'],
    run: ({ editor }) => {
      editor.chain().focus().insertTableOfContents('figure').refreshTableOfContents().run()
    },
  },
  {
    id: 'insert.list-of-tables',
    label: 'List of Tables',
    group: 'insert',
    keywords: ['tables', 'captions', 'index'],
    run: ({ editor }) => {
      editor.chain().focus().insertTableOfContents('table').refreshTableOfContents().run()
    },
  },
  {
    id: 'insert.figure-caption',
    label: 'Figure Caption',
    group: 'insert',
    keywords: ['caption', 'figure', 'picture', 'number'],
    run: ({ editor }) => {
      editor.chain().focus().insertCaption('figure').run()
    },
  },
  {
    id: 'insert.table-caption',
    label: 'Table Caption',
    group: 'insert',
    keywords: ['caption', 'table', 'number'],
    run: ({ editor }) => {
      editor.chain().focus().insertCaption('table').run()
    },
  },
  {
    id: 'insert.refresh-table-of-contents',
    label: 'Update Table of Contents',
    group: 'insert',
    keywords: ['toc', 'refresh', 'regenerate'],
    run: ({ editor }) => {
      editor.chain().focus().refreshTableOfContents().run()
    },
    isEnabled: ({ editor }) => editor.state.doc.content.size > 0,
  },
  {
    id: 'insert.special-character',
    label: 'Special Characters…',
    group: 'insert',
    keywords: ['symbol', 'emoji', 'unicode', 'dash', 'quote'],
    run: () => {
      requestPicker('special-characters')
    },
  },
  {
    id: 'insert.link',
    label: 'Link…',
    group: 'insert',
    shortcut: 'Mod+k',
    keywords: ['url', 'hyperlink', 'anchor'],
    run: () => {
      requestPicker('link')
    },
    isActive: ({ editor }) => editor.isActive('link'),
  },
  {
    id: 'insert.remove-link',
    label: 'Remove Link',
    group: 'insert',
    keywords: ['unlink'],
    run: ({ editor }) => {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
    },
    isEnabled: ({ editor }) => editor.isActive('link'),
  },
  {
    id: 'insert.open-link',
    label: 'Open Link',
    group: 'insert',
    keywords: ['visit', 'browser'],
    run: ({ editor }) => {
      const href: unknown = editor.getAttributes('link')['href']
      if (typeof href !== 'string') return
      // Opened through the webview so the OS handler takes over; the URL was
      // validated by `normalizeUrl` before it ever reached the document.
      window.open(href, '_blank', 'noopener,noreferrer')
    },
    isEnabled: ({ editor }) => editor.isActive('link'),
  },
]
