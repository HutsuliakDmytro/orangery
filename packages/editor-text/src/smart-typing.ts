import { Extension, InputRule } from '@tiptap/core'
import type { ResolvedPos } from '@tiptap/pm/model'

/**
 * Typographic substitutions made while typing.
 *
 * What a keyboard produces and what a document should contain are not the same
 * characters: a straight quote, two hyphens and three full stops all stand in
 * for marks the keyboard has no key for. Word calls this autocorrect and it is
 * on by default; so is this, and the settings dialog turns it off.
 *
 * Quotes differ by language, so the language is worked out from the text around
 * the cursor rather than from a setting the user has to remember to change.
 */

export const EM_DASH = '—'
export const ELLIPSIS = '…'
export const NO_BREAK_SPACE = ' '
export const RIGHT_SINGLE_QUOTE = '’'

/** The pair a language opens and closes a quotation with. */
export const QUOTES: Readonly<Record<'uk' | 'en', { open: string; close: string }>> = {
  // Ukrainian typography uses guillemets, English uses raised quotes.
  uk: { open: '«', close: '»' },
  en: { open: '“', close: '”' },
}

export type QuoteLanguage = keyof typeof QUOTES

export interface SmartTypingOptions {
  /** Read on every substitution, so turning it off takes effect at once. */
  enabled: () => boolean
  /** Used when the text around the cursor says nothing about the language. */
  fallbackLanguage: () => QuoteLanguage
}

const CYRILLIC = /\p{Script=Cyrillic}/u
const LATIN = /\p{Script=Latin}/u
const WORD_CHARACTER = /[\p{L}\p{N}]/u
/** Characters after which a quote opens rather than closes. */
const BEFORE_OPENING = /[\s([{«“—–-]/u

/**
 * The language of the text a quote is being typed into.
 *
 * Decided by the nearest letter rather than by a setting: a Ukrainian document
 * written with an English interface is ordinary, and the quotation marks belong
 * to the text, not to the menus.
 */
export function quoteLanguage(before: string, fallback: QuoteLanguage): QuoteLanguage {
  for (let index = before.length - 1; index >= 0; index -= 1) {
    const character = before[index] ?? ''
    if (CYRILLIC.test(character)) return 'uk'
    if (LATIN.test(character)) return 'en'
  }

  return fallback
}

/** Everything to the left of the cursor within its own block. */
function textBefore($from: ResolvedPos): string {
  return $from.parent.textBetween(0, $from.parentOffset)
}

export const SmartTyping = Extension.create<SmartTypingOptions>({
  name: 'smartTyping',

  addOptions() {
    return {
      enabled: () => true,
      fallbackLanguage: () => 'en',
    }
  },

  addInputRules() {
    const { enabled, fallbackLanguage } = this.options

    /** Replaces the matched text, or leaves it alone when switched off. */
    const replace = (
      range: { from: number; to: number },
      text: string,
      state: { tr: { insertText: (text: string, from: number, to: number) => unknown } },
    ) => {
      if (!enabled()) return
      state.tr.insertText(text, range.from, range.to)
    }

    return [
      new InputRule({
        find: /\.\.\.$/u,
        handler: ({ state, range }) => {
          replace(range, ELLIPSIS, state)
        },
      }),

      new InputRule({
        find: /--$/u,
        handler: ({ state, range }) => {
          if (!enabled()) return

          const $from = state.doc.resolve(range.from)

          const before = textBefore($from)

          // A line made of nothing but hyphens so far is on its way to a
          // horizontal rule, which is typed as three of them. An em dash never
          // opens a line, so standing aside there costs nothing and keeps that
          // rule reachable.
          if (/^-*$/u.test(before)) return

          // The dash must never start a line, so the space in front of it is
          // the one that cannot break. This is the rule Ukrainian typography
          // states outright and English typesetting follows in practice.
          const spaceBefore = before.endsWith(' ')
          const from = spaceBefore ? range.from - 1 : range.from

          state.tr.insertText(spaceBefore ? `${NO_BREAK_SPACE}${EM_DASH}` : EM_DASH, from, range.to)
        },
      }),

      new InputRule({
        find: /"$/u,
        handler: ({ state, range }) => {
          if (!enabled()) return

          const before = textBefore(state.doc.resolve(range.from))
          const previous = before.slice(-1)
          const quotes = QUOTES[quoteLanguage(before, fallbackLanguage())]

          const opening = previous === '' || BEFORE_OPENING.test(previous)
          state.tr.insertText(opening ? quotes.open : quotes.close, range.from, range.to)
        },
      }),

      new InputRule({
        find: /'$/u,
        handler: ({ state, range }) => {
          if (!enabled()) return

          const previous = textBefore(state.doc.resolve(range.from)).slice(-1)
          // Only inside a word, where it is an apostrophe in both languages.
          // A quotation opened with a single mark is left alone: in Ukrainian
          // that character is a letter's own, not punctuation.
          if (!WORD_CHARACTER.test(previous)) return

          state.tr.insertText(RIGHT_SINGLE_QUOTE, range.from, range.to)
        },
      }),
    ]
  },
})
