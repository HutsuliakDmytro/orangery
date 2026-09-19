import '@testing-library/jest-dom/vitest'

/**
 * The grid's own recording canvas, because the sheet is drawn on one.
 *
 * jsdom has no 2-D context, so a component that paints would get null and
 * render nothing — and every assertion about the sheet would pass while
 * proving nothing. The grid already keeps a canvas that remembers what it was
 * asked to draw; borrowing it means the two never disagree about what a
 * context has to answer.
 */
export { recorded } from '@orangery/grid/testing'
