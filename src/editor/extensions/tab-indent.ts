import { Extension } from '@tiptap/core'

/**
 * Tab and Shift+Tab.
 *
 * Inside a list they change nesting depth, which the list extensions already
 * handle, so the key is not claimed there.
 *
 * Elsewhere the key does what it does in Word: at the start of a paragraph it
 * indents the first line, and anywhere else it types a tab character. Without
 * the second half a tab cannot be typed at all, which leaves the paragraph's
 * tab stops reachable only in a document that arrived with them.
 */
export const TabIndent = Extension.create({
  name: 'tabIndent',
  // Below the list extensions so their Tab handling wins inside a list.
  priority: 90,

  addKeyboardShortcuts() {
    return {
      Tab: () => {
        if (this.editor.isActive('listItem') || this.editor.isActive('taskItem')) return false

        const { empty, $from } = this.editor.state.selection
        if (empty && $from.parentOffset === 0) return this.editor.commands.indent()

        return this.editor.commands.insertContent('\t')
      },
      'Shift-Tab': () => {
        if (this.editor.isActive('listItem') || this.editor.isActive('taskItem')) return false
        return this.editor.commands.outdent()
      },
    }
  },
})
