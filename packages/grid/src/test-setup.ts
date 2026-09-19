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
  align?: string
  font?: string
}

export interface FilledRect {
  x: number
  y: number
  width: number
  height: number
  style: string
}

export interface RecordedCanvas {
  texts: DrawnText[]
  strokedRects: { x: number; y: number; width: number; height: number }[]
  /** Fills, with the colour each was made in — a cell's background. */
  fills: FilledRect[]
  /** Lines, with their colour: gridlines, borders, the frozen edge. */
  lines: { from: [number, number]; to: [number, number]; style: string }[]
  reset: () => void
}

export const recorded: RecordedCanvas = {
  texts: [],
  strokedRects: [],
  fills: [],
  lines: [],
  reset: () => {
    recorded.texts = []
    recorded.strokedRects = []
    recorded.fills = []
    recorded.lines = []
  },
}

/** Where the last `moveTo` put the pen, so a `lineTo` can be recorded as a line. */
let pen: [number, number] = [0, 0]

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
  fillRect: (x: number, y: number, width: number, height: number) => {
    recorded.fills.push({ x, y, width, height, style: context.fillStyle })
  },
  save: () => undefined,
  restore: () => undefined,
  beginPath: () => undefined,
  rect: () => undefined,
  clip: () => undefined,
  moveTo: (x: number, y: number) => {
    pen = [x, y]
  },
  lineTo: (x: number, y: number) => {
    recorded.lines.push({ from: pen, to: [x, y], style: context.strokeStyle })
    pen = [x, y]
  },
  stroke: () => undefined,
  fillText: (text: string, x: number, y: number) => {
    recorded.texts.push({ text, x, y, align: context.textAlign, font: context.font })
  },
  strokeRect: (x: number, y: number, width: number, height: number) => {
    recorded.strokedRects.push({ x, y, width, height })
  },
}

// The fake answers the handful of calls the grid makes and nothing else, so
// it is handed over as unknown rather than pretending to be the whole 2-D API.
HTMLCanvasElement.prototype.getContext = (() =>
  context) as unknown as HTMLCanvasElement['getContext']
