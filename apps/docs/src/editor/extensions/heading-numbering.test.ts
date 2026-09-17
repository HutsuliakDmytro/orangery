import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor } from '../../test/editor-harness'
import { useViewStore } from '../../store/view-store'
import { runCommand } from '@orangery/ui-kit'

let editor: Editor

beforeEach(() => {
  useViewStore.setState({ headingNumbering: null })
  editor = createTestEditor('<h1>one</h1><h2>under</h2><h1>two</h1>')
})

afterEach(() => {
  editor.destroy()
  useViewStore.setState({ headingNumbering: null })
})

/** The numbers actually on the page, read back out of the rendered document. */
function drawn(): (string | null)[] {
  return [...editor.view.dom.querySelectorAll('.heading-number')].map(
    (element) => element.textContent,
  )
}

describe('heading numbering', () => {
  it('draws nothing while the document is unnumbered', () => {
    expect(drawn()).toEqual([])
  })

  it('draws a number for each heading once a scheme is chosen', () => {
    runCommand('paragraph.heading-numbers-decimal', { editor })
    expect(drawn()).toEqual(['1.', '1.1.', '2.'])
  })

  it('switches scheme without the document being edited', () => {
    runCommand('paragraph.heading-numbers-outline', { editor })
    expect(drawn()).toEqual(['I.', 'A.', 'II.'])
  })

  it('running the scheme that is on turns numbering off', () => {
    runCommand('paragraph.heading-numbers-decimal', { editor })
    runCommand('paragraph.heading-numbers-decimal', { editor })

    expect(drawn()).toEqual([])
    expect(useViewStore.getState().headingNumbering).toBeNull()
  })

  it('renumbers when a heading is added', () => {
    runCommand('paragraph.heading-numbers-decimal', { editor })
    editor.commands.setContent('<h1>a</h1><h1>b</h1><h1>c</h1>')

    expect(drawn()).toEqual(['1.', '2.', '3.'])
  })

  it('does not put the number into the text of the document', () => {
    runCommand('paragraph.heading-numbers-decimal', { editor })

    // A number typed into the heading would have to be renumbered by hand,
    // which is the problem numbering exists to solve.
    expect(editor.state.doc.textContent).toBe('oneundertwo')
  })
})
