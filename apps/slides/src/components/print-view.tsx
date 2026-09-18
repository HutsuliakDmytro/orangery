import { readSlidePart } from '@orangery/ooxml-presentation'
import { textOfBody } from '@orangery/ooxml-drawingml'
import type { Slide } from '@orangery/ooxml-presentation'
import { SlideView } from '../render/slide-view'
import { useDeckStore } from '../store/deck-store'
import { useViewStore } from '../store/view-store'
import { PAGES, pageRule, pagesOf } from '../print/layout'

/**
 * The deck laid out for paper.
 *
 * PDF comes out of the browser's own print pipeline rather than out of a PDF
 * writer of our own. A second way of drawing a slide is a second way of drawing
 * it wrongly, and this one already handles the hard parts — text that wraps,
 * fonts that have to be embedded, a page size that is not A4 — because it is
 * the same renderer under `@media print`.
 *
 * It also means "export to PDF" and "print" are one mechanism rather than two
 * that disagree, which is what they are on the operating system anyway.
 */

export function PrintView() {
  const open = useDeckStore((state) => state.open)
  const layout = useViewStore((state) => state.printLayout)

  if (open === null) return null

  const { columns } = PAGES[layout]
  const pages = pagesOf(open.deck.slides, layout)

  /** The notes of a slide, for the layout that prints them under it. */
  const notesOf = (slide: Slide) => {
    if (slide.notes == null) return ''

    const part = readSlidePart(open.package, slide.notes)
    const body = part?.shapes.find((shape) => shape.placeholder?.type === 'body')
    return body?.text == null ? '' : textOfBody(body.text)
  }

  return (
    <div data-testid="print-view" className="orangery-print" aria-label="Print preview">
      {/* The page size follows the layout, so it has to be written out rather
          than sat in a stylesheet. */}
      <style>{pageRule(layout, open.deck.slideSize)}</style>

      {pages.map((page, index) => (
        <section
          key={index}
          data-testid="print-page"
          className="orangery-print-page"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${String(columns)}, 1fr)`,
            gap: '0.4in',
          }}
        >
          {page.map((slide) => (
            <article key={slide.path} data-testid="print-slide">
              <SlideView
                deck={open.deck}
                slide={slide}
                themes={open.themes}
                package={open.package}
                className="w-full border border-border"
              />
              {layout === 'notes' && (
                <p
                  data-testid="print-notes"
                  className="whitespace-pre-wrap pt-4 text-sm text-black"
                >
                  {notesOf(slide)}
                </p>
              )}
            </article>
          ))}
        </section>
      ))}
    </div>
  )
}
