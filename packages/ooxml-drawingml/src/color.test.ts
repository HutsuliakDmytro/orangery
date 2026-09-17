import { parseXml } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import { readColor, readColorChild, resolveColor } from './color'
import type { Color, ColorContext } from './color'

function node(xml: string): XmlNode {
  const parsed = parseXml(xml)[0]
  if (parsed === undefined) throw new Error(`not parseable: ${xml}`)
  return parsed
}

const office: ColorContext = {
  scheme: new Map<string, Color>([
    ['dk1', { source: { kind: 'system', name: 'windowText', lastHex: '#000000' }, transforms: [] }],
    ['lt1', { source: { kind: 'system', name: 'window', lastHex: '#FFFFFF' }, transforms: [] }],
    ['accent1', { source: { kind: 'srgb', hex: '#4F81BD' }, transforms: [] }],
  ]),
  map: new Map([
    ['tx1', 'dk1'],
    ['bg1', 'lt1'],
    ['accent1', 'accent1'],
  ]),
}

describe('readColor', () => {
  it('keeps a theme colour symbolic', () => {
    // Resolving here would bake today's palette into the model, and a theme
    // change would stop recolouring the file.
    const color = readColor(node('<a:schemeClr val="accent1"/>'))
    expect(color?.source).toEqual({ kind: 'scheme', name: 'accent1' })
  })

  it('reads a literal colour', () => {
    expect(readColor(node('<a:srgbClr val="ff7a00"/>'))?.source).toEqual({
      kind: 'srgb',
      hex: '#FF7A00',
    })
  })

  it('keeps the last value a system colour was computed as', () => {
    expect(readColor(node('<a:sysClr val="windowText" lastClr="000000"/>'))?.source).toEqual({
      kind: 'system',
      name: 'windowText',
      lastHex: '#000000',
    })
  })

  it('keeps the modifiers in the order they were written', () => {
    // They do not commute: lightening then darkening is not the reverse.
    const color = readColor(
      node(
        '<a:schemeClr val="accent1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>',
      ),
    )

    expect(color?.transforms).toEqual([
      { kind: 'lumMod', value: 0.6 },
      { kind: 'lumOff', value: 0.4 },
    ])
  })

  it('finds the colour inside a fill', () => {
    const fill = node('<a:solidFill><a:srgbClr val="161616"/></a:solidFill>')
    expect(readColorChild(fill)?.source).toEqual({ kind: 'srgb', hex: '#161616' })
  })

  it('returns null for a fill that names no colour', () => {
    expect(readColorChild(node('<a:noFill/>'))).toBeNull()
  })
})

describe('resolveColor', () => {
  const resolve = (xml: string, context = office) => {
    const color = readColor(node(xml))
    return color === null ? null : resolveColor(color, context)
  }

  it('goes through the colour map, which is a different vocabulary', () => {
    // A shape says tx1; the scheme has no tx1, only dk1. Without the master's
    // map this finds nothing.
    expect(resolve('<a:schemeClr val="tx1"/>')?.hex).toBe('#000000')
    expect(resolve('<a:schemeClr val="bg1"/>')?.hex).toBe('#FFFFFF')
  })

  it('resolves a scheme slot that is itself a system colour', () => {
    expect(resolve('<a:schemeClr val="accent1"/>')?.hex).toBe('#4F81BD')
  })

  it('returns null for a slot the theme does not define', () => {
    expect(resolve('<a:schemeClr val="accent9"/>')).toBeNull()
  })

  it('lightens with tint and darkens with shade', () => {
    expect(resolve('<a:srgbClr val="000000"><a:tint val="50000"/></a:srgbClr>')?.hex).toBe(
      '#808080',
    )
    expect(resolve('<a:srgbClr val="FFFFFF"><a:shade val="50000"/></a:srgbClr>')?.hex).toBe(
      '#808080',
    )
  })

  it('carries alpha separately from the colour', () => {
    const resolved = resolve('<a:srgbClr val="FF7A00"><a:alpha val="50000"/></a:srgbClr>')
    expect(resolved).toEqual({ hex: '#FF7A00', alpha: 0.5 })
  })

  it('applies luminance modifiers in HSL, where luminance means something', () => {
    // The lumMod 60% / lumOff 40% pair is the "lighter 40%" theme variant every
    // deck uses, so this is the arithmetic PowerPoint's own palette relies on.
    const lighter = resolve(
      '<a:schemeClr val="tx1"><a:lumMod val="60000"/><a:lumOff val="40000"/></a:schemeClr>',
    )
    expect(lighter?.hex).toBe('#666666')
  })

  it('resolves phClr to the colour the style was invoked with', () => {
    const context = {
      ...office,
      placeholderColor: { source: { kind: 'srgb' as const, hex: '#FF7A00' }, transforms: [] },
    }
    expect(resolve('<a:schemeClr val="phClr"/>', context)?.hex).toBe('#FF7A00')
  })

  it('returns null for phClr with nothing to stand for', () => {
    expect(resolve('<a:schemeClr val="phClr"/>')).toBeNull()
  })
})
