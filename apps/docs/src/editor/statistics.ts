/**
 * Document statistics for the status bar.
 *
 * Page count is an estimate: MVP renders a continuous view, so there is no real
 * pagination to count (CLAUDE.md "Known hard problems"). The estimate uses the
 * same rule of thumb Word's status bar falls back to — a full page of body text
 * at the default size — and is labelled as approximate in the UI.
 */

export interface DocumentStatistics {
  words: number
  characters: number
  charactersWithoutSpaces: number
  pages: number
}

/** Roughly what fits on a Letter page at 11pt with 1" margins and 1.15 spacing. */
export const WORDS_PER_PAGE = 500

export function countWords(text: string): number {
  const trimmed = text.trim()
  if (trimmed === '') return 0
  // Split on whitespace; CJK text has no spaces, so each character counts as a
  // word there, which is what Word does too.
  const cjk = trimmed.match(/[぀-ヿ一-鿿가-힯]/gu)?.length ?? 0
  const latin = trimmed
    .replace(/[぀-ヿ一-鿿가-힯]/gu, ' ')
    .split(/\s+/u)
    .filter((word) => word !== '').length
  return latin + cjk
}

/**
 * Counts grapheme clusters, not code points: a ZWJ emoji sequence is one
 * character to the person typing it, and a word processor's counter has to agree.
 */
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

export function countCharacters(text: string): number {
  let count = 0
  for (const _ of segmenter.segment(text)) count += 1
  return count
}

export function computeStatistics(text: string): DocumentStatistics {
  const words = countWords(text)

  return {
    words,
    characters: countCharacters(text),
    charactersWithoutSpaces: countCharacters(text.replace(/\s/gu, '')),
    pages: Math.max(1, Math.ceil(words / WORDS_PER_PAGE)),
  }
}
