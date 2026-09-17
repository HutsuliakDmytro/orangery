import type { Editor } from '@tiptap/core'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  ELLIPSIS,
  EM_DASH,
  NO_BREAK_SPACE,
  quoteLanguage,
  RIGHT_SINGLE_QUOTE,
  SmartTyping,
} from './smart-typing'
import type { QuoteLanguage } from './smart-typing'
import { createTextEditor, type } from './test-editor'

let editor: Editor
let enabled: boolean
let fallback: QuoteLanguage

function build(): Editor {
  return createTextEditor([
    SmartTyping.configure({ enabled: () => enabled, fallbackLanguage: () => fallback }),
  ])
}

beforeEach(() => {
  enabled = true
  fallback = 'en'
  editor = build()
})

afterEach(() => {
  editor.destroy()
})

const text = () => editor.state.doc.textContent
const typing = (value: string) => {
  type(editor, value)
}

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
    typing('wait...')
    expect(text()).toBe(`wait${ELLIPSIS}`)
  })

  it('turns two hyphens into an em dash', () => {
    typing('a--b')
    expect(text()).toBe(`a${EM_DASH}b`)
  })

  it('makes the space before a dash unbreakable', () => {
    // The dash must never start a line, so it is the space in front of it that
    // cannot break.
    typing('word --')
    expect(text()).toBe(`word${NO_BREAK_SPACE}${EM_DASH}`)
  })

  it('turns an apostrophe inside a word into the typographic one', () => {
    typing("don't")
    expect(text()).toBe(`don${RIGHT_SINGLE_QUOTE}t`)
  })

  it('leaves a single mark alone outside a word', () => {
    // In Ukrainian that character belongs to the letters, not to punctuation.
    typing("'quoted")
    expect(text()).toBe("'quoted")
  })
})

describe('quotes', () => {
  it('opens and closes in English', () => {
    typing('he said "hello" then')
    expect(text()).toBe('he said “hello” then')
  })

  it('opens and closes in Ukrainian, going by the text', () => {
    typing('він сказав "привіт" далі')
    expect(text()).toBe('він сказав «привіт» далі')
  })

  it('opens at the very start of a paragraph', () => {
    typing('"start')
    expect(text()).toBe('“start')
  })

  it('opens after a bracket, not closes', () => {
    typing('text ("inside')
    expect(text()).toBe('text (“inside')
  })

  it('closes straight after a word', () => {
    typing('word"')
    expect(text()).toBe('word”')
  })

  it('uses the fallback language when the text says nothing', () => {
    fallback = 'uk'

    typing('"')
    expect(text()).toBe('«')
  })
})

describe('the enabled option', () => {
  it('leaves everything alone when it reads false', () => {
    enabled = false

    typing('a--b "c" d...')
    expect(text()).toBe('a--b "c" d...')
  })

  it('is read on every substitution, not once at build time', () => {
    typing('a...')
    enabled = false
    typing(' b...')

    expect(text()).toBe(`a${ELLIPSIS} b...`)
  })
})

describe('leaving room for the rules around it', () => {
  it('does not take the hyphens that open a horizontal rule', () => {
    typing('--- ')
    expect(editor.getHTML()).toContain('<hr>')
  })

  it('still makes a dash once there is something in front of it', () => {
    typing('a--')
    expect(text()).toBe(`a${EM_DASH}`)
  })
})
