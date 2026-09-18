import { describe, expect, it } from 'vitest'
import { applyDrag } from './use-drag'
import type { DragState } from './use-drag'

const box = { x: 1000, y: 2000, width: 400, height: 200 }

const drag = (values: Partial<DragState>): DragState => ({
  dx: 0,
  dy: 0,
  handle: null,
  shift: false,
  alt: false,
  scale: 1,
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
