import '@testing-library/jest-dom/vitest'

/**
 * A canvas that answers, because the grid draws on one.
 *
 * jsdom has no 2-D context, so a component that paints would get null and
 * render nothing — and every assertion about the sheet would pass while
 * proving nothing. This is enough of a context for the grid to run through.
 */
const context = {
  canvas: null,
  font: '',
  textAlign: 'left',
  textBaseline: 'middle',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  setTransform: () => undefined,
  clearRect: () => undefined,
  fillRect: () => undefined,
  save: () => undefined,
  restore: () => undefined,
  beginPath: () => undefined,
  rect: () => undefined,
  clip: () => undefined,
  moveTo: () => undefined,
  lineTo: () => undefined,
  stroke: () => undefined,
  fillText: () => undefined,
  strokeRect: () => undefined,
}

HTMLCanvasElement.prototype.getContext = (() =>
  context) as unknown as HTMLCanvasElement['getContext']
