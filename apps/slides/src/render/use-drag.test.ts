import { describe, expect, it } from 'vitest'
import { applyDrag, applyRotation } from './use-drag'
import type { DragState } from './use-drag'

const box = { x: 1000, y: 2000, width: 400, height: 200 }

const drag = (values: Partial<DragState>): DragState => ({
  dx: 0,
  dy: 0,
  handle: null,
  shift: false,
  alt: false,
  scale: 1,
  from: { x: 0, y: 0 },
  to: { x: 0, y: 0 },
  ...values,
})

describe('moving', () => {
  it('shifts the shape by the drag', () => {
    expect(applyDrag(box, drag({ dx: 50, dy: -30 }))).toEqual({
      x: 1050,
      y: 1970,
      width: 400,
      height: 200,
    })
  })

  it('constrains to one axis with shift, following the larger movement', () => {
    expect(applyDrag(box, drag({ dx: 50, dy: 10, shift: true })).y).toBe(2000)
    expect(applyDrag(box, drag({ dx: 10, dy: 50, shift: true })).x).toBe(1000)
  })
})

describe('resizing from a corner', () => {
  it('grows from the south-east without moving the other corner', () => {
    expect(applyDrag(box, drag({ dx: 100, dy: 50, handle: 'se' }))).toEqual({
      x: 1000,
      y: 2000,
      width: 500,
      height: 250,
    })
  })

  it('moves the origin when dragging the north-west', () => {
    // The opposite corner has to stay where it is.
    expect(applyDrag(box, drag({ dx: -100, dy: -50, handle: 'nw' }))).toEqual({
      x: 900,
      y: 1950,
      width: 500,
      height: 250,
    })
  })

  it('keeps the aspect ratio with shift', () => {
    const resized = applyDrag(box, drag({ dx: 200, dy: 0, handle: 'se', shift: true }))
    expect(resized.width / resized.height).toBeCloseTo(box.width / box.height, 5)
  })

  it('resizes about the centre with alt', () => {
    const resized = applyDrag(box, drag({ dx: 50, dy: 0, handle: 'se', alt: true }))

    expect(resized.width).toBe(500)
    // The centre was 1200; it still is.
    expect(resized.x + resized.width / 2).toBe(1200)
  })

  it('stops at nothing rather than turning the shape inside out', () => {
    const resized = applyDrag(box, drag({ dx: -1000, dy: -1000, handle: 'se' }))

    expect(resized.width).toBe(0)
    expect(resized.height).toBe(0)
  })
})

describe('the edge handles', () => {
  it('moves only the edge that was grabbed', () => {
    // The top, dragged down and sideways: the width must not budge.
    expect(applyDrag(box, drag({ handle: 'n', dx: 500, dy: 50 }))).toEqual({
      x: 1000,
      y: 2050,
      width: 400,
      height: 150,
    })
  })

  it('moves the right edge without moving the shape', () => {
    expect(applyDrag(box, drag({ handle: 'e', dx: 100, dy: 999 }))).toEqual({
      x: 1000,
      y: 2000,
      width: 500,
      height: 200,
    })
  })

  it('moves the left edge and the shape with it', () => {
    expect(applyDrag(box, drag({ handle: 'w', dx: 100 }))).toEqual({
      x: 1100,
      y: 2000,
      width: 300,
      height: 200,
    })
  })

  it('resizes from the centre with Alt, both sides at once', () => {
    expect(applyDrag(box, drag({ handle: 'e', dx: 50, alt: true }))).toEqual({
      x: 950,
      y: 2000,
      width: 500,
      height: 200,
    })
  })

  it('does not keep the proportions on an edge, whatever Shift says', () => {
    // Shift on an edge would move the edge nobody grabbed.
    expect(applyDrag(box, drag({ handle: 's', dy: 100, shift: true }))).toEqual({
      x: 1000,
      y: 2000,
      width: 400,
      height: 300,
    })
  })
})

describe('turning a shape', () => {
  const square = { x: 0, y: 0, width: 200, height: 200 }
  const centre = { x: 100, y: 100 }

  const turn = (from: { x: number; y: number }, to: { x: number; y: number }, shift = false) =>
    applyRotation({ rotation: 0 }, square, drag({ handle: 'rotate', from, to, shift }))

  it('turns by the angle the pointer swept, not by where it ended', () => {
    // A quarter turn clockwise: from above the centre to the right of it.
    expect(turn({ x: centre.x, y: 0 }, { x: 200, y: centre.y })).toBe(90 * 60000)
  })

  it('turns the other way too', () => {
    expect(turn({ x: centre.x, y: 0 }, { x: 0, y: centre.y })).toBe(270 * 60000)
  })

  it('adds to the angle the shape already had', () => {
    const already = { rotation: 90 * 60000 }
    const state = drag({ handle: 'rotate', from: { x: 100, y: 0 }, to: { x: 200, y: 100 } })
    expect(applyRotation(already, square, state)).toBe(180 * 60000)
  })

  it('wraps rather than counting past a full turn', () => {
    const already = { rotation: 350 * 60000 }
    const state = drag({ handle: 'rotate', from: { x: 100, y: 0 }, to: { x: 200, y: 100 } })
    expect(applyRotation(already, square, state)).toBe(80 * 60000)
  })

  it('snaps to fifteen degrees with Shift', () => {
    // Forty-five would be exact; something close to it must land on it.
    const nearly = turn({ x: 100, y: 0 }, { x: 180, y: 25 }, true)
    expect(nearly % (15 * 60000)).toBe(0)
  })

  it('leaves the rectangle alone, because turning is not sizing', () => {
    expect(applyDrag(box, drag({ handle: 'rotate', dx: 500, dy: 500 }))).toEqual(box)
  })
})
