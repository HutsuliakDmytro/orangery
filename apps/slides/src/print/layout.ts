import type { PrintLayout } from '../store/view-store'

/**
 * How a deck is arranged on paper.
 *
 * Pure arithmetic, kept away from the component that uses it: how many slides
 * go on a page and how large that page is are the two things a print gets
 * wrong, and neither is visible in a test environment that never paginates.
 */

/** How many slides go on a page, and in how many columns. */
export const PAGES: Record<PrintLayout, { perPage: number; columns: number }> = {
  slides: { perPage: 1, columns: 1 },
  notes: { perPage: 1, columns: 1 },
  'handout-2': { perPage: 2, columns: 1 },
  'handout-3': { perPage: 3, columns: 1 },
  'handout-6': { perPage: 6, columns: 2 },
}

/** Splits the deck into the pages it will be printed on. */
export function pagesOf<T>(slides: readonly T[], layout: PrintLayout): T[][] {
  const perPage = PAGES[layout].perPage
  const pages: T[][] = []

  for (let at = 0; at < slides.length; at += perPage) {
    pages.push(slides.slice(at, at + perPage))
  }

  // One empty page rather than none, so a deck that is somehow empty still
  // prints something and the count is never a surprise.
  return pages.length === 0 ? [[]] : pages
}

/**
 * The page size for a layout, as an `@page` rule.
 *
 * Slides print at the size of the slide: a deck made for a 16:9 screen on an A4
 * page is the same picture with two white bands, and a PDF of the deck should
 * be the deck. Everything that puts more than one on a page is paper, and paper
 * is A4.
 */
export function pageRule(layout: PrintLayout, slide: { width: number; height: number }): string {
  if (layout !== 'slides') return '@page { size: A4 portrait; margin: 0.5in; }'

  // EMU to inches, to two decimals: a page size is not a coordinate.
  const inches = (emu: number) => (emu / 914400).toFixed(2)
  return `@page { size: ${inches(slide.width)}in ${inches(slide.height)}in; margin: 0; }`
}
