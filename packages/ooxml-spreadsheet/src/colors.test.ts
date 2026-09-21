import { describe, expect, it } from 'vitest'
import { applyTint, paletteOf, resolveColor } from './colors'

/**
 * What a cell's colour actually is.
 *
 * A workbook states colours four ways and only one of them is a colour. These
 * are about the other three — and about the two places where the obvious
 * reading is wrong and nothing on screen would tell you.
 */

const palette = paletteOf(
  {
    colors: new Map([
      ['dk1', '000000'],
      ['lt1', 'FFFFFF'],
      ['dk2', '44546A'],
      ['lt2', 'E7E6E6'],
      ['accent1', '4472C4'],
      ['accent2', 'ED7D31'],
      ['accent6', '70AD47'],
      ['hlink', '0563C1'],
    ]),
  },
  { foreground: '000000', background: 'FFFFFF' },
)

describe('a colour the file states outright', () => {
  it('keeps the six digits that matter, dropping the alpha Excel writes', () => {
    expect(resolveColor({ kind: 'rgb', hex: 'FFFF7A00' }, palette)).toBe('FF7A00')
    expect(resolveColor({ kind: 'rgb', hex: '4472C4' }, palette)).toBe('4472C4')
  })

  it('is nothing at all when it is not a colour', () => {
    expect(resolveColor({ kind: 'rgb', hex: 'nonsense' }, palette)).toBeNull()
  })
})

describe('a colour taken from the theme', () => {
  it('reads the index Excel means, not the order the theme is written in', () => {
    // The first two are swapped: `theme="0"` is the light background and
    // `theme="1"` is the dark text. A reader that trusted the file's order
    // draws black text on black.
    expect(resolveColor({ kind: 'theme', index: 0, tint: 0 }, palette)).toBe('FFFFFF')
    expect(resolveColor({ kind: 'theme', index: 1, tint: 0 }, palette)).toBe('000000')
  })

  it('finds the accents where Excel counts them', () => {
    expect(resolveColor({ kind: 'theme', index: 4, tint: 0 }, palette)).toBe('4472C4')
    expect(resolveColor({ kind: 'theme', index: 9, tint: 0 }, palette)).toBe('70AD47')
  })

  it('says nothing for a slot the theme does not define', () => {
    expect(resolveColor({ kind: 'theme', index: 11, tint: 0 }, palette)).toBeNull()
    expect(resolveColor({ kind: 'theme', index: 99, tint: 0 }, palette)).toBeNull()
  })
})

describe('lightening and darkening', () => {
  it('moves the lightness rather than blending with white or black', () => {
    // The obvious guess — mix with white — gives visibly different colours.
    expect(applyTint('000000', 0.5)).toBe('808080')
    expect(applyTint('FFFFFF', -0.5)).toBe('808080')
  })

  it('leaves the colour alone at nought', () => {
    expect(applyTint('4472C4', 0)).toBe('4472C4')
  })

  it('reaches white and black at the ends', () => {
    expect(applyTint('4472C4', 1)).toBe('FFFFFF')
    expect(applyTint('4472C4', -1)).toBe('000000')
  })

  it('keeps the hue while it changes the lightness', () => {
    // A lighter accent is the same colour, which is the whole point of a theme
    // being six colours rather than sixty.
    const lighter = applyTint('4472C4', 0.4)

    expect(lighter).not.toBe('4472C4')
    expect(Number.parseInt(lighter.slice(4, 6), 16)).toBeGreaterThan(
      Number.parseInt(lighter.slice(0, 2), 16),
    )
  })

  it('applies to a theme colour as the file asks', () => {
    expect(resolveColor({ kind: 'theme', index: 0, tint: -0.5 }, palette)).toBe('808080')
  })
})

describe('the palette from 1997', () => {
  it('reads the indexes every writer still uses', () => {
    expect(resolveColor({ kind: 'indexed', index: 0 }, palette)).toBe('000000')
    expect(resolveColor({ kind: 'indexed', index: 2 }, palette)).toBe('FF0000')
    expect(resolveColor({ kind: 'indexed', index: 22 }, palette)).toBe('C0C0C0')
  })

  it('hands the system colours back to whoever asked', () => {
    // 64 and 65 are the reader's own foreground and background, which is to
    // say a decision this cannot make.
    expect(resolveColor({ kind: 'indexed', index: 64 }, palette)).toBe('000000')
    expect(resolveColor({ kind: 'indexed', index: 65 }, palette)).toBe('FFFFFF')
  })

  it('says nothing for an index outside the palette', () => {
    expect(resolveColor({ kind: 'indexed', index: 200 }, palette)).toBeNull()
  })
})

describe('a colour the file leaves to the reader', () => {
  it('is nothing rather than a default', () => {
    // What an unstated colour means depends on where it is: an unstated fill
    // is no fill, which is not the same as a white one.
    expect(resolveColor({ kind: 'auto' }, palette)).toBeNull()
    expect(resolveColor(null, palette)).toBeNull()
  })
})
