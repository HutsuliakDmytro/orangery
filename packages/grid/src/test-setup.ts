/**
 * A canvas that remembers what it was told to draw.
 *
 * jsdom has no 2-D context, so a grid under test would paint into nothing and
 * every assertion about it would be vacuous. This records the calls instead,
 * which is what the tests ask about: not pixels, but "was this value drawn,
 * and where".
 *
 * Shared as `@orangery/grid/testing` because an app that draws through this
 * grid has the same problem and the same questions, and two recorders would
 * drift apart the first time the grid learned to draw something new.
 */

export interface DrawnText {
  text: string
  x: number
  y: number
  align?: string
  font?: string
  /** Where the pen was moved to before the text, for anything turned. */
  origin?: [number, number]
  /** Radians, clockwise on a canvas; 0 for the text that is simply level. */
  angle?: number
}

export interface FilledRect {
  x: number
  y: number
  width: number
  height: number
  style: string
}

/** A filled path — an icon, which is a shape rather than a rectangle. */
export interface FilledPath {
  points: [number, number][]
  /** Whether the path was curved, which is how a circle is told from a diamond. */
  curved: boolean
  style: string
}

export interface RecordedCanvas {
  texts: DrawnText[]
  strokedRects: { x: number; y: number; width: number; height: number }[]
  /** Fills, with the colour each was made in — a cell's background. */
  fills: FilledRect[]
  /** Lines, with their colour: gridlines, borders, the frozen edge. */
  lines: { from: [number, number]; to: [number, number]; style: string }[]
  /** Shapes, with the colour each was filled in. */
  paths: FilledPath[]
  reset: () => void
}

export const recorded: RecordedCanvas = {
  texts: [],
  strokedRects: [],
  fills: [],
  lines: [],
  paths: [],
  reset: () => {
    recorded.texts = []
    recorded.strokedRects = []
    recorded.fills = []
    recorded.lines = []
    recorded.paths = []
    path = []
    curved = false
    origin = [0, 0]
    angle = 0
    stack.length = 0
  },
}

/** What `save` put away, for `restore` to take back. */
const stack: [[number, number], number][] = []

/** Where the last `moveTo` put the pen, so a `lineTo` can be recorded as a line. */
let pen: [number, number] = [0, 0]

/** The path being built, which becomes a shape when something fills it. */
let path: [number, number][] = []
let curved = false

/**
 * The transform, as much of it as anything here asks about.
 *
 * Turned text is drawn at the origin with the canvas moved and rotated under
 * it, so a recorder that kept only the co-ordinates would report every
 * rotated value as being at nought, nought.
 */
let origin: [number, number] = [0, 0]
let angle = 0

const context = {
  canvas: null,
  font: '',
  textAlign: 'left',
  textBaseline: 'middle',
  fillStyle: '',
  strokeStyle: '',
  lineWidth: 1,
  setTransform: () => {
    origin = [0, 0]
    angle = 0
  },
  translate: (x: number, y: number) => {
    origin = [origin[0] + x, origin[1] + y]
  },
  rotate: (radians: number) => {
    angle += radians
  },
  measureText: (text: string) => ({ width: text.length * 7 }),
  clearRect: () => undefined,
  fillRect: (x: number, y: number, width: number, height: number) => {
    recorded.fills.push({ x, y, width, height, style: context.fillStyle })
  },
  save: () => {
    stack.push([origin, angle])
  },
  restore: () => {
    const held = stack.pop()
    if (held !== undefined) [origin, angle] = held
  },
  beginPath: () => {
    path = []
    curved = false
  },
  rect: () => undefined,
  clip: () => undefined,
  closePath: () => undefined,
  arc: (x: number, y: number) => {
    curved = true
    path.push([x, y])
    pen = [x, y]
  },
  fill: () => {
    if (path.length > 0)
      recorded.paths.push({ points: [...path], curved, style: context.fillStyle })
  },
  moveTo: (x: number, y: number) => {
    pen = [x, y]
    path.push([x, y])
  },
  lineTo: (x: number, y: number) => {
    recorded.lines.push({ from: pen, to: [x, y], style: context.strokeStyle })
    pen = [x, y]
    path.push([x, y])
  },
  stroke: () => undefined,
  fillText: (text: string, x: number, y: number) => {
    recorded.texts.push({
      text,
      x,
      y,
      align: context.textAlign,
      font: context.font,
      origin: [...origin],
      angle,
    })
  },
  strokeRect: (x: number, y: number, width: number, height: number) => {
    recorded.strokedRects.push({ x, y, width, height })
  },
}

// The fake answers the handful of calls the grid makes and nothing else, so
// it is handed over as unknown rather than pretending to be the whole 2-D API.
HTMLCanvasElement.prototype.getContext = (() =>
  context) as unknown as HTMLCanvasElement['getContext']
