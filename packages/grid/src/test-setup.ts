/**
 * A canvas that remembers what it was told to draw.
 *
 * jsdom has no 2-D context, so a grid under test would paint into nothing and
 * every assertion about it would be vacuous. This records the calls instead,
 * which is what the tests ask about: not pixels, but "was this value drawn,
 * and where".
 */

export interface DrawnText {
  text: string
  x: number
  y: number
}

export interface RecordedCanvas {
  texts: DrawnText[]
  strokedRects: { x: number; y: number; width: number; height: number }[]
  reset: () => void
}

export const recorded: RecordedCanvas = {
  texts: [],
  strokedRects: [],
  reset: () => {
    recorded.texts = []
    recorded.strokedRects = []
  },
}

const context = {
  canvas: null,
  font: '',
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
  fillText: (text: string, x: number, y: number) => {
    recorded.texts.push({ text, x, y })
  },
  strokeRect: (x: number, y: number, width: number, height: number) => {
    recorded.strokedRects.push({ x, y, width, height })
  },
}

// The fake answers the handful of calls the grid makes and nothing else, so
// it is handed over as unknown rather than pretending to be the whole 2-D API.
HTMLCanvasElement.prototype.getContext = (() =>
  context) as unknown as HTMLCanvasElement['getContext']
