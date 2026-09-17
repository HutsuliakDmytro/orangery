import { describe, expect, it } from 'vitest'
import { EMU_PER_CENTIMETRE, EMU_PER_INCH, emuToPoints, fitWithin, pointsToEmu } from './units'

describe('EMU conversion', () => {
  it('converts EMU to points', () => {
    expect(emuToPoints(EMU_PER_INCH)).toBe(72)
  })

  it('converts points back to EMU', () => {
    expect(pointsToEmu(72)).toBe(EMU_PER_INCH)
  })

  it('round-trips a non-round size', () => {
    expect(emuToPoints(pointsToEmu(216))).toBe(216)
  })

  it('divides evenly into centimetres, which is the point of the unit', () => {
    expect(EMU_PER_INCH % EMU_PER_CENTIMETRE).not.toBe(0)
    expect(EMU_PER_CENTIMETRE * 2.54).toBe(EMU_PER_INCH)
  })
})

describe('fitWithin', () => {
  it('leaves an image that already fits alone', () => {
    expect(fitWithin({ width: 200, height: 100 }, 468)).toEqual({ width: 200, height: 100 })
  })

  it('scales a wide image down and keeps the aspect ratio', () => {
    expect(fitWithin({ width: 1000, height: 500 }, 468)).toEqual({ width: 468, height: 234 })
  })

  it('falls back to the column width for a zero-sized image', () => {
    expect(fitWithin({ width: 0, height: 0 }, 468).width).toBe(468)
  })
})
