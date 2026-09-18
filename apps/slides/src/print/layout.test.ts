import { describe, expect, it } from 'vitest'
import { PAGES, pageRule, pagesOf } from './layout'

/** How a deck is arranged on paper. */

const slides = (count: number) => Array.from({ length: count }, (_, index) => index)

const WIDE = { width: 12192000, height: 6858000 }
const STANDARD = { width: 9144000, height: 6858000 }

describe('splitting a deck into pages', () => {
  it('puts one slide on a page for the plain layout', () => {
    expect(pagesOf(slides(3), 'slides')).toEqual([[0], [1], [2]])
  })

  it('puts one on a page for notes too, since the notes go under it', () => {
    expect(pagesOf(slides(2), 'notes')).toEqual([[0], [1]])
  })

  it('fills a handout to the number it is named for', () => {
    expect(pagesOf(slides(6), 'handout-2')).toHaveLength(3)
    expect(pagesOf(slides(6), 'handout-3')).toHaveLength(2)
    expect(pagesOf(slides(6), 'handout-6')).toHaveLength(1)
  })

  it('leaves the last page short rather than dropping what is on it', () => {
    const pages = pagesOf(slides(7), 'handout-6')

    expect(pages).toHaveLength(2)
    expect(pages[1]).toEqual([6])
  })

  it('keeps the slides in order across the pages', () => {
    expect(pagesOf(slides(5), 'handout-2')).toEqual([[0, 1], [2, 3], [4]])
  })

  it('gives one empty page for a deck with nothing in it', () => {
    // A count that is never a surprise, even when the answer is nothing.
    expect(pagesOf([], 'slides')).toEqual([[]])
  })
})

describe('the page size', () => {
  it('is the size of the slide when slides are what is printed', () => {
    // A 16:9 deck on A4 is the same picture with two white bands.
    expect(pageRule('slides', WIDE)).toContain('13.33in 7.50in')
    expect(pageRule('slides', STANDARD)).toContain('10.00in 7.50in')
  })

  it('leaves no margin around a slide, which is its own page', () => {
    expect(pageRule('slides', WIDE)).toContain('margin: 0')
  })

  it('is paper for everything that puts more than one on a page', () => {
    for (const layout of ['notes', 'handout-2', 'handout-3', 'handout-6'] as const) {
      expect(pageRule(layout, WIDE)).toContain('A4 portrait')
    }
  })
})

describe('the arrangement', () => {
  it('puts six to a page in two columns and the rest in one', () => {
    expect(PAGES['handout-6'].columns).toBe(2)
    expect(PAGES['handout-3'].columns).toBe(1)
  })
})
