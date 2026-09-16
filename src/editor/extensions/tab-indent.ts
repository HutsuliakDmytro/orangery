import { Extension } from '@tiptap/core'

/**
 * Tab and Shift+Tab.
 *
 * Inside a list they change nesting depth, which the list extensions already
 * handle — this only claims the key when the cursor is not in a list item, where
 * Word and Docs indent the paragraph instead of inserting a tab character.
 */
export const TabIndent = Extension.create({
  name: 'tabIndent',
  // Below the list extensions so their Tab handling wins inside a list.
  priority: 90,

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('listItem') || this.editor.isActive('taskItem')) return false
        return this.editor.commands.indent()
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('listItem') || this.editor.isActive('taskItem')) return false
        return this.editor.commands.outdent()
      },
    }
  },
})
