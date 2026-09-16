import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createTestEditor } from '../../test/editor-harness'
import { useSettingsStore } from '../../store/settings-store'
import { ELLIPSIS, EM_DASH, NO_BREAK_SPACE, quoteLanguage, RIGHT_SINGLE_QUOTE } from './smart-typing'

let editor: Editor

beforeEach(() => {
  useSettingsStore.setState({ smartTyping: true, language: 'en' })
  editor = createTestEditor('<p></p>')
})

afterEach(() => {
  editor.destroy()
})

/**
 * Types text one character at a time.
 *
 * Input rules fire on insertion, so pasting the whole string in would skip
 * every one of them — which is also why they must not fire on paste.
 */
function type(text: string): void {
  for (const character of text) {
    const { from, to } = editor.state.selection

    // The rule handler both applies the substitution and stands in for the
    // insertion, exactly as it does when a browser delivers the keystroke.
    const handled = editor.view.someProp(
      'handleTextInput',
      (handler) => handler(editor.view, from, to, character, () => editor.state.tr) === true,
    )
    if (handled !== true) editor.commands.insertContent(character)
  }
}

const text = () => editor.state.doc.textContent

describe('quoteLanguage', () => {
  it('follows the nearest letter, not the interface', () => {
    expect(quoteLanguage('слово ', 'en')).toBe('uk')
    expect(quoteLanguage('word ', 'uk')).toBe('en')
  })

  it('looks past punctuation and spaces to find one', () => {
    expect(quoteLanguage('слово, (', 'en')).toBe('uk')
  })

  it('falls back when there is no letter to go by', () => {
    expect(quoteLanguage('', 'uk')).toBe('uk')
    expect(quoteLanguage('123 — ', 'en')).toBe('en')
  })
})

describe('substitutions', () => {
  it('turns three full stops into an ellipsis', () => {
    type('wait...')
    expect(text()).toBe(`wait${ELLIPSIS}`)
  })

  it('turns two hyphens into an em dash', () => {
    type('a--b')
    expect(text()).toBe(`a${EM_DASH}b`)
  })

  it('makes the space before a dash unbreakable', () => {
    // The dash must never start a line, so it is the space in front of it that
    // cannot break.
    type('word --')
    expect(text()).toBe(`word${NO_BREAK_SPACE}${EM_DASH}`)
  })

  it('turns an apostrophe inside a word into the typographic one', () => {
    type("don't")
    expect(text()).toBe(`don${RIGHT_SINGLE_QUOTE}t`)
  })

  it('leaves a single mark alone outside a word', () => {
    // In Ukrainian that character belongs to the letters, not to punctuation.
    type("'quoted")
    expect(text()).toBe("'quoted")
  })
})

describe('quotes', () => {
  it('opens and closes in English', () => {
    type('he said "hello" then')
    expect(text()).toBe('he said “hello” then')
  })

  it('opens and closes in Ukrainian, going by the text', () => {
    type('він сказав "привіт" далі')
    expect(text()).toBe('він сказав «привіт» далі')
  })

  it('opens at the very start of a paragraph', () => {
    type('"start')
    expect(text()).toBe('“start')
  })

  it('opens after a bracket, not closes', () => {
    type('text ("inside')
    expect(text()).toBe('text (“inside')
  })

  it('closes straight after a word', () => {
    type('word"')
    expect(text()).toBe('word”')
  })

  it('uses the interface language when the text says nothing', () => {
    useSettingsStore.setState({ language: 'uk' })
    editor.destroy()
    editor = createTestEditor('<p></p>')

    type('"')
    expect(text()).toBe('«')
  })
})

describe('the setting', () => {
  it('leaves everything alone when it is off', () => {
    useSettingsStore.setState({ smartTyping: false })

    type('a--b "c" d...')
    expect(text()).toBe('a--b "c" d...')
  })

  it('takes effect without the editor being rebuilt', () => {
    type('a...')
    useSettingsStore.setState({ smartTyping: false })
    type(' b...')

    expect(text()).toBe(`a${ELLIPSIS} b...`)
  })
})


describe('leaving room for the rules around it', () => {
  it('does not take the hyphens that open a horizontal rule', () => {
    type('--- ')
    expect(editor.getHTML()).toContain('<hr>')
  })

  it('still makes a dash once there is something in front of it', () => {
    type('a--')
    expect(text()).toBe(`a${EM_DASH}`)
  })
})
