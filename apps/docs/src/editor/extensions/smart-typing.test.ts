import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ELLIPSIS } from '@orangery/editor-text'
import { createTestEditor } from '../../test/editor-harness'
import { useSettingsStore } from '../../store/settings-store'

/**
 * Smart typing itself is tested in `@orangery/editor-text`, against that
 * package alone. What is Docs' own is the wiring: the extension reads its
 * options from the settings store, and the interface language stands in when
 * the text gives nothing to go by.
 *
 * Worth a test of its own because the wiring is a pair of closures — an option
 * read once at build time instead of on every keystroke would still typecheck,
 * still work on a fresh editor, and stop responding to the switch.
 */

let editor: Editor

beforeEach(() => {
  useSettingsStore.setState({ smartTyping: true, language: 'en' })
  editor = createTestEditor('<p></p>')
})

afterEach(() => {
  editor.destroy()
})

function type(text: string): void {
  for (const character of text) {
    const { from, to } = editor.state.selection
    const handled = editor.view.someProp(
      'handleTextInput',
      (handler) => handler(editor.view, from, to, character, () => editor.state.tr) === true,
    )
    if (handled !== true) editor.commands.insertContent(character)
  }
}

const text = () => editor.state.doc.textContent

describe('the settings store driving smart typing', () => {
  it('substitutes while the setting is on', () => {
    type('a...')
    expect(text()).toBe(`a${ELLIPSIS}`)
  })

  it('stops as soon as the setting goes off, without rebuilding the editor', () => {
    type('a...')
    useSettingsStore.setState({ smartTyping: false })
    type(' b...')

    expect(text()).toBe(`a${ELLIPSIS} b...`)
  })

  it('quotes by the interface language when the text says nothing', () => {
    useSettingsStore.setState({ language: 'uk' })

    type('"')
    expect(text()).toBe('«')
  })
})
