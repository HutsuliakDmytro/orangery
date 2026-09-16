import { describe, expect, it } from 'vitest'
import { cssColor, cssFontFamily, cssLengthToPoints, cssProperties } from './css-values'

describe('cssProperties', () => {
  it('splits a style attribute into its declarations', () => {
    const properties = cssProperties('color: red; font-size:  12pt ;')

    expect(properties.get('color')).toBe('red')
    expect(properties.get('font-size')).toBe('12pt')
  })

  it('ignores a fragment that declares nothing', () => {
    expect(cssProperties('color')).toHaveLength(0)
    expect(cssProperties(null)).toHaveLength(0)
  })
})

describe('cssColor', () => {
  it('reads hex in both lengths', () => {
    expect(cssColor('#f00')).toBe('#FF0000')
    expect(cssColor('#00ff00')).toBe('#00FF00')
  })

  it('reads the rgb function, with or without an alpha', () => {
    expect(cssColor('rgb(255, 0, 0)')).toBe('#FF0000')
    expect(cssColor('rgba(0, 0, 255, 0.5)')).toBe('#0000FF')
    expect(cssColor('rgb(100% 0% 0%)')).toBe('#FF0000')
  })

  it('treats a fully transparent colour as no colour', () => {
    expect(cssColor('rgba(0, 0, 0, 0)')).toBeNull()
    expect(cssColor('transparent')).toBeNull()
  })

  it('leaves a colour it cannot state in six digits alone', () => {
    expect(cssColor('red')).toBeNull()
    expect(cssColor('color-mix(in srgb, red, blue)')).toBeNull()
    expect(cssColor(undefined)).toBeNull()
  })
})

describe('cssLengthToPoints', () => {
  it('converts the absolute units', () => {
    expect(cssLengthToPoints('12pt')).toBe(12)
    expect(cssLengthToPoints('96px')).toBe(72)
    expect(cssLengthToPoints('1in')).toBe(72)
  })

  it('leaves a relative length alone rather than guessing a number', () => {
    expect(cssLengthToPoints('1.5em')).toBeNull()
    expect(cssLengthToPoints('120%')).toBeNull()
    expect(cssLengthToPoints('12')).toBeNull()
  })
})

describe('cssFontFamily', () => {
  it('takes the first family and drops its quotes', () => {
    expect(cssFontFamily('"Times New Roman", serif')).toBe('Times New Roman')
    expect(cssFontFamily('Georgia')).toBe('Georgia')
    expect(cssFontFamily(undefined)).toBeNull()
  })
})
