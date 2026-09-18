import { describe, expect, it } from 'vitest'
import { EMU_PER_INCH } from '@orangery/ooxml-drawingml'
import { emuToLength, lengthToEmu } from './lengths'

describe('reading an OpenDocument length', () => {
  it('reads every unit a writer might have used', () => {
    expect(lengthToEmu('1in')).toBe(EMU_PER_INCH)
    expect(lengthToEmu('2.54cm')).toBe(EMU_PER_INCH)
    expect(lengthToEmu('25.4mm')).toBe(EMU_PER_INCH)
    expect(lengthToEmu('72pt')).toBe(EMU_PER_INCH)
    expect(lengthToEmu('6pc')).toBe(EMU_PER_INCH)
    expect(lengthToEmu('96px')).toBe(EMU_PER_INCH)
  })

  it('tolerates the spacing a hand-edited file has', () => {
    expect(lengthToEmu(' 2.54 cm ')).toBe(EMU_PER_INCH)
  })

  it('reads a negative offset, which a frame off the page has', () => {
    expect(lengthToEmu('-1in')).toBe(-EMU_PER_INCH)
  })

  it('takes a bare number for points', () => {
    expect(lengthToEmu('72')).toBe(EMU_PER_INCH)
  })

  it('says nothing about a unit it does not know', () => {
    expect(lengthToEmu('3parsecs')).toBeNull()
    expect(lengthToEmu('')).toBeNull()
    expect(lengthToEmu(undefined)).toBeNull()
  })
})

describe('writing one', () => {
  it('comes back as what went in', () => {
    const emu = lengthToEmu(emuToLength(EMU_PER_INCH * 3))
    expect(emu).toBe(EMU_PER_INCH * 3)
  })

  it('is centimetres, which is what Impress writes', () => {
    expect(emuToLength(EMU_PER_INCH)).toBe('2.540cm')
  })
})
