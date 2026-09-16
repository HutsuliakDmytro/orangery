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
