import { describe, expect, it } from 'vitest'
import { iconOf } from './icon-sets'

/**
 * Excel's icon sets, as shapes.
 *
 * What is asserted is what somebody would see and complain about: an arrow
 * pointing the wrong way, three lights that are all the same colour, a rating
 * that never fills up. The exact hexes are not asserted — they are read off
 * the product and will move when there is a real workbook to compare with.
 */

describe('arrows', () => {
  it('points down at the bottom of the scale and up at the top', () => {
    expect(iconOf('3Arrows', 0, 3).direction).toBe('down')
    expect(iconOf('3Arrows', 2, 3).direction).toBe('up')
  })

  it('uses the middle directions a longer set has room for', () => {
    expect(iconOf('5Arrows', 1, 5).direction).toBe('downRight')
    expect(iconOf('5Arrows', 2, 5).direction).toBe('right')
    expect(iconOf('5Arrows', 3, 5).direction).toBe('upRight')
  })

  it('greys the set that asks to be grey, and only that one', () => {
    expect(iconOf('3ArrowsGray', 2, 3).color).toBe(iconOf('3ArrowsGray', 0, 3).color)
    expect(iconOf('3Arrows', 2, 3).color).not.toBe(iconOf('3Arrows', 0, 3).color)
  })
})

describe('the sets that are not arrows', () => {
  it('gives the three lights three colours and one shape', () => {
    const lights = [0, 1, 2].map((index) => iconOf('3TrafficLights1', index, 3))

    expect(new Set(lights.map((one) => one.shape))).toEqual(new Set(['circle']))
    expect(new Set(lights.map((one) => one.color)).size).toBe(3)
  })

  it('gives the signs a shape each, for a reader who cannot tell red from green', () => {
    const signs = [0, 1, 2].map((index) => iconOf('3Signs', index, 3).shape)
    expect(new Set(signs).size).toBe(3)
  })

  it('earns a bar for the lowest band of a rating and all of them for the highest', () => {
    expect(iconOf('4Rating', 0, 4)).toMatchObject({ shape: 'bars', filled: 1, steps: 4 })
    expect(iconOf('4Rating', 3, 4)).toMatchObject({ filled: 4 })
  })

  it('leaves the lowest quarter empty, which is what a quarter of nothing looks like', () => {
    expect(iconOf('5Quarters', 0, 5)).toMatchObject({ shape: 'pie', filled: 0, steps: 4 })
    expect(iconOf('5Quarters', 4, 5)).toMatchObject({ filled: 4 })
  })
})

describe('a set nobody here has heard of', () => {
  it('is drawn as lights rather than not drawn', () => {
    // A cell with nothing where an icon belongs looks like a cell with no rule
    // on it, which is the one thing it is not.
    const icon = iconOf('5Boxes2000', 1, 3)

    expect(icon.shape).toBe('circle')
    expect(icon.color).toBeTruthy()
  })
})
