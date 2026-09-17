import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor } from '../../test/editor-harness'
import { runCommand } from '@orangery/ui-kit'

let editor: Editor

/** `kept added removed`, with the last two marked as a change each. */
const reviewed = {
  type: 'doc',
  content: [
    {
      type: 'paragraph',
      content: [
        { type: 'text', text: 'kept ' },
        { type: 'text', text: 'added', marks: [{ type: 'insertion', attrs: { author: 'Ada' } }] },
        { type: 'text', text: 'removed', marks: [{ type: 'deletion', attrs: { author: 'Ada' } }] },
      ],
    },
  ],
}

beforeEach(() => {
  editor = createTestEditor(reviewed as never)
})

afterEach(() => {
  editor.destroy()
})

const text = () => editor.state.doc.textContent
const marks = () => {
  const found: string[] = []
  editor.state.doc.descendants((node) => {
    if (node.isText) found.push(...node.marks.map((mark) => mark.type.name))
    return true
  })
  return found
}

describe('accepting', () => {
  it('keeps what was added and removes what was taken out', () => {
    editor.commands.acceptRevisions(true)
    expect(text()).toBe('kept added')
  })

  it('leaves no marks behind, so the text is plain again', () => {
    editor.commands.acceptRevisions(true)
    expect(marks()).toEqual([])
  })
})

describe('rejecting', () => {
  it('removes what was added and keeps what was taken out', () => {
    editor.commands.rejectRevisions(true)
    expect(text()).toBe('kept removed')
  })

  it('leaves no marks behind either', () => {
    editor.commands.rejectRevisions(true)
    expect(marks()).toEqual([])
  })
})

describe('settling one change rather than all of them', () => {
  it('leaves the changes the selection does not touch', () => {
    // `kept ` is 1..6, the insertion 6..11, the deletion 11..18.
    editor.commands.setTextSelection({ from: 6, to: 11 })
    editor.commands.acceptRevisions(false)

    expect(text()).toBe('kept addedremoved')
    expect(marks()).toEqual(['deletion'])
  })

  it('settles everything when nothing is selected', () => {
    runCommand('edit.accept-revisions', { editor })
    expect(text()).toBe('kept added')
  })
})

describe('two people on the same words', () => {
  it('keeps both marks, since one did not replace the other', () => {
    editor.commands.setContent({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'both',
              marks: [
                { type: 'insertion', attrs: { author: 'Ada' } },
                { type: 'deletion', attrs: { author: 'Bob' } },
              ],
            },
          ],
        },
      ],
    })

    expect(marks()).toEqual(expect.arrayContaining(['insertion', 'deletion']))
  })
})
