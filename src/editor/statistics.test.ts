import { describe, expect, it } from 'vitest'
import { computeStatistics, countWords, WORDS_PER_PAGE } from './statistics'

describe('countWords', () => {
  it('counts space-separated words', () => {
    expect(countWords('one two three')).toBe(3)
  })

  it('ignores leading, trailing and repeated whitespace', () => {
    expect(countWords('  one   two  ')).toBe(2)
  })

  it('returns zero for empty or blank text', () => {
    expect(countWords('')).toBe(0)
    expect(countWords('   \n\t ')).toBe(0)
  })

  it('counts each CJK character as a word, like Word does', () => {
    expect(countWords('日本語')).toBe(3)
  })

  it('handles mixed scripts', () => {
    expect(countWords('hello 日本 world')).toBe(4)
  })

  it('counts hyphenated words once', () => {
    expect(countWords('well-known example')).toBe(2)
  })
})

describe('computeStatistics', () => {
  it('counts characters with and without spaces', () => {
    const stats = computeStatistics('ab cd')
    expect(stats.characters).toBe(5)
    expect(stats.charactersWithoutSpaces).toBe(4)
  })

  it('counts astral characters as one', () => {
    expect(computeStatistics('👍').characters).toBe(1)
  })

  it('counts a ZWJ emoji sequence as one character', () => {
    expect(computeStatistics('👨‍👩‍👧').characters).toBe(1)
  })

  it('counts a combining accent with its base letter', () => {
    expect(computeStatistics('é').characters).toBe(1)
  })

  it('never reports fewer than one page', () => {
    expect(computeStatistics('').pages).toBe(1)
  })

  it('rolls over to a second page past the per-page estimate', () => {
    const text = Array.from({ length: WORDS_PER_PAGE + 1 }, () => 'word').join(' ')
    expect(computeStatistics(text).pages).toBe(2)
  })
})
