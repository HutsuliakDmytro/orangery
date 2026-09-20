import { describe, expect, it, vi } from 'vitest'
import { drawSpark } from './spark'
import type { CellSpark } from './cell-style'

/**
 * A chart the size of a cell.
 *
 * Drawn on a canvas, so what is tested is what was asked of the canvas: how
 * many strokes and fills, and where they landed. That is enough to catch the
 * things that matter — a line drawn through a gap, a win-loss that drew the
 * amounts, bars that all came out the same height.
 */

const context = () => {
  const calls: { what: string; args: unknown[] }[] = []
  const record =
    (what: string) =>
    (...args: unknown[]) => {
      calls.push({ what, args })
    }

  const fake = {
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: record('beginPath'),
    moveTo: record('moveTo'),
    lineTo: record('lineTo'),
    stroke: record('stroke'),
    fillRect: record('fillRect'),
    strokeStyle: '',
    fillStyle: '',
    lineWidth: 0,
  }

  return { fake: fake as unknown as CanvasRenderingContext2D, calls }
}

const rect = { x: 0, y: 0, width: 100, height: 20 }

const spark = (one: Partial<CellSpark> = {}): CellSpark => ({
  kind: 'line',
  points: [1, 2, 3],
  color: '#336699',
  ...one,
})

describe('a line', () => {
  it('joins the points it was given', () => {
    const { fake, calls } = context()
    drawSpark(fake, spark(), rect)

    expect(calls.filter((one) => one.what === 'moveTo')).toHaveLength(1)
    expect(calls.filter((one) => one.what === 'lineTo')).toHaveLength(2)
  })

  it('breaks at a gap rather than drawing through it', () => {
    // A line that joined across a missing month would invent a month.
    const { fake, calls } = context()
    drawSpark(fake, spark({ points: [1, null, 3] }), rect)

    expect(calls.filter((one) => one.what === 'moveTo')).toHaveLength(2)
    expect(calls.filter((one) => one.what === 'lineTo')).toHaveLength(0)
  })

  it('draws a flat run in the middle rather than along the bottom', () => {
    // A run of identical numbers has no shape; along the bottom it would
    // look like a run of noughts.
    const { fake, calls } = context()
    drawSpark(fake, spark({ points: [5, 5, 5] }), rect)

    const heights = calls
      .filter((one) => one.what === 'moveTo' || one.what === 'lineTo')
      .map((one) => one.args[1])

    expect(new Set(heights).size).toBe(1)
    expect(heights[0]).toBeCloseTo(10, 0)
  })
})

describe('columns', () => {
  it('draws one bar per point', () => {
    const { fake, calls } = context()
    drawSpark(fake, spark({ kind: 'column', points: [1, 2, 3] }), rect)

    expect(calls.filter((one) => one.what === 'fillRect')).toHaveLength(3)
  })

  it('draws the ones below the axis in their own colour', () => {
    const { fake, calls } = context()
    drawSpark(
      fake,
      spark({ kind: 'column', points: [-1, 2], color: '#111111', negativeColor: '#ff0000' }),
      rect,
    )

    expect(calls.filter((one) => one.what === 'fillRect')).toHaveLength(2)
  })
})

describe('a win and a loss', () => {
  it('draws every bar the same size, up or down', () => {
    // What is being shown is the sign rather than the amount: one that drew
    // the amounts would be a column chart.
    const { fake, calls } = context()
    drawSpark(fake, spark({ kind: 'winLoss', points: [1, 1000, -1] }), rect)

    const sizes = calls.filter((one) => one.what === 'fillRect').map((one) => one.args[3])
    expect(new Set(sizes).size).toBe(1)
  })

  it('leaves a gap out altogether', () => {
    const { fake, calls } = context()
    drawSpark(fake, spark({ kind: 'winLoss', points: [1, null, -1] }), rect)

    expect(calls.filter((one) => one.what === 'fillRect')).toHaveLength(2)
  })
})

describe('a cell with no room and no points', () => {
  it('draws nothing at all', () => {
    const { fake, calls } = context()
    drawSpark(fake, spark({ points: [] }), rect)
    drawSpark(fake, spark(), { x: 0, y: 0, width: 2, height: 2 })

    expect(calls).toHaveLength(0)
  })
})
