import { parseXml } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import { resolveColor } from './color'
import type { ColorContext } from './color'
import { hasEffects, readFill, readShapeProperties, readShapeStyle } from './shape-properties'
import { shadowOffset } from './effects'

function node(xml: string): XmlNode {
  const parsed = parseXml(xml)[0]
  if (parsed === undefined) throw new Error(`not parseable: ${xml}`)
  return parsed
}

const theme: ColorContext = {
  scheme: new Map([
    ['accent1', { source: { kind: 'srgb' as const, hex: '#4F81BD' }, transforms: [] }],
  ]),
  map: new Map([['accent1', 'accent1']]),
}

describe('absent is not the same as none', () => {
  it('reports no fill stated as null', () => {
    // The shape takes its fill from its style reference or its placeholder.
    const properties = readShapeProperties(node('<a:spPr><a:prstGeom prst="rect"/></a:spPr>'))
    expect(properties.fill).toBeNull()
  })

  it('reports an explicit noFill as a fill of none', () => {
    const properties = readShapeProperties(node('<a:spPr><a:noFill/></a:spPr>'))
    expect(properties.fill).toEqual({ kind: 'none' })
  })

  it('keeps the same distinction for the line', () => {
    expect(readShapeProperties(node('<a:spPr/>')).line).toBeNull()
    expect(readShapeProperties(node('<a:spPr><a:ln/></a:spPr>')).line?.fill).toBeNull()
  })
})

describe('fills', () => {
  it('reads a solid fill as a colour the theme can resolve later', () => {
    const fill = readFill(node('<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>'))

    expect(fill?.kind).toBe('solid')
    const color = fill?.kind === 'solid' ? fill.color : null
    expect(color === null ? null : resolveColor(color, theme)?.hex).toBe('#4F81BD')
  })

  it('reads gradient stops with their positions as fractions', () => {
    const fill = readFill(
      node(
        '<a:gradFill><a:gsLst>' +
          '<a:gs pos="0"><a:srgbClr val="000000"/></a:gs>' +
          '<a:gs pos="100000"><a:srgbClr val="FFFFFF"/></a:gs>' +
          '</a:gsLst><a:lin ang="5400000"/></a:gradFill>',
      ),
    )

    expect(fill).toMatchObject({ kind: 'gradient', radial: false, angle: 5400000 })
    expect(fill?.kind === 'gradient' ? fill.stops.map((stop) => stop.position) : []).toEqual([0, 1])
  })

  it('tells a radial gradient from a linear one', () => {
    const fill = readFill(node('<a:gradFill><a:gsLst/><a:path path="circle"/></a:gradFill>'))
    expect(fill).toMatchObject({ kind: 'gradient', radial: true })
  })

  it('reads a pattern with both of its colours', () => {
    const fill = readFill(
      node(
        '<a:pattFill prst="pct25"><a:fgClr><a:srgbClr val="FF7A00"/></a:fgClr>' +
          '<a:bgClr><a:srgbClr val="000000"/></a:bgClr></a:pattFill>',
      ),
    )

    expect(fill).toMatchObject({ kind: 'pattern', preset: 'pct25' })
  })

  it('reads a picture fill as the relationship it points at', () => {
    const fill = readFill(node('<a:blipFill><a:blip r:embed="rId3"/></a:blipFill>'))
    expect(fill).toEqual({ kind: 'picture', relationshipId: 'rId3' })
  })

  it('reads grpFill, which defers to the enclosing group', () => {
    expect(readFill(node('<a:grpFill/>'))).toEqual({ kind: 'group' })
  })
})

describe('geometry', () => {
  it('reads the preset a shape is drawn from', () => {
    const properties = readShapeProperties(
      node('<a:spPr><a:prstGeom prst="roundRect"><a:avLst/></a:prstGeom></a:spPr>'),
    )
    expect(properties.geometry).toMatchObject({ kind: 'preset', preset: 'roundRect' })
  })

  it('keeps the adjustments that reshape the preset', () => {
    // These are the corner radius, the arrow head size — exactly what is lost by
    // rebuilding a shape from a model that only knows "rounded rectangle".
    const properties = readShapeProperties(
      node(
        '<a:spPr><a:prstGeom prst="roundRect"><a:avLst>' +
          '<a:gd name="adj" fmla="val 25000"/>' +
          '</a:avLst></a:prstGeom></a:spPr>',
      ),
    )

    expect(properties.geometry?.adjustments.get('adj')).toBe('val 25000')
  })

  it('marks custom geometry without pretending to model the path', () => {
    const properties = readShapeProperties(
      node('<a:spPr><a:custGeom><a:pathLst/></a:custGeom></a:spPr>'),
    )
    expect(properties.geometry).toMatchObject({ kind: 'custom', preset: null })
  })
})

describe('lines', () => {
  it('reads width, dash, cap and colour', () => {
    const properties = readShapeProperties(
      node(
        '<a:spPr><a:ln w="25400" cap="rnd">' +
          '<a:solidFill><a:srgbClr val="FF7A00"/></a:solidFill>' +
          '<a:prstDash val="dash"/></a:ln></a:spPr>',
      ),
    )

    expect(properties.line).toMatchObject({ width: 25400, dash: 'dash', cap: 'round' })
    expect(properties.line?.fill).toMatchObject({ kind: 'solid' })
  })

  it('reads the arrowheads at either end', () => {
    const properties = readShapeProperties(
      node(
        '<a:spPr><a:ln><a:headEnd type="none"/>' +
          '<a:tailEnd type="triangle" w="med" len="med"/></a:ln></a:spPr>',
      ),
    )

    expect(properties.line?.head).toEqual({ type: 'none', width: null, length: null })
    expect(properties.line?.tail).toEqual({ type: 'triangle', width: 'med', length: 'med' })
  })
})

describe('the style reference', () => {
  it('reads the slots a shape takes its look from', () => {
    const style = readShapeStyle(
      node(
        '<p:style><a:lnRef idx="1"><a:schemeClr val="accent1"/></a:lnRef>' +
          '<a:fillRef idx="3"><a:schemeClr val="accent1"/></a:fillRef>' +
          '<a:effectRef idx="2"><a:schemeClr val="accent1"/></a:effectRef>' +
          '<a:fontRef idx="minor"><a:schemeClr val="lt1"/></a:fontRef></p:style>',
      ),
    )

    expect(style.fill).toMatchObject({ index: 3 })
    expect(style.line?.color?.source).toEqual({ kind: 'scheme', name: 'accent1' })
    // `idx` on a font reference is a name, not a number; it reads as 0 rather
    // than throwing, and resolving it is a job for the format scheme.
    expect(style.font?.index).toBe(0)
  })
})

describe('effects', () => {
  it('notices an effect list without modelling it', () => {
    expect(hasEffects(node('<a:spPr><a:effectLst><a:outerShdw/></a:effectLst></a:spPr>'))).toBe(
      true,
    )
    expect(hasEffects(node('<a:spPr><a:effectLst/></a:spPr>'))).toBe(false)
    expect(hasEffects(node('<a:spPr/>'))).toBe(false)
  })
})

describe('the drop shadow', () => {
  it('is read from the effect list', () => {
    const properties = node(
      '<p:spPr><a:effectLst><a:outerShdw blurRad="50800" dist="38100" dir="2700000"><a:srgbClr val="000000"><a:alpha val="40000"/></a:srgbClr></a:outerShdw></a:effectLst></p:spPr>',
    )

    const shadow = readShapeProperties(properties).shadow
    expect(shadow).toMatchObject({ blur: 50800, distance: 38100, direction: 2700000 })
    expect(shadow?.color?.source).toEqual({ kind: 'srgb', hex: '#000000' })
  })

  it('is null for a shape that has none', () => {
    expect(readShapeProperties(node('<p:spPr/>')).shadow).toBeNull()
  })

  it('is null when the effect list holds something else', () => {
    const properties = node('<p:spPr><a:effectLst><a:glow rad="50800"/></a:effectLst></p:spPr>')
    expect(readShapeProperties(properties).shadow).toBeNull()
  })

  it('turns a distance and an angle into an offset', () => {
    // 45° down and to the right: both components positive and equal.
    const offset = shadowOffset({ distance: 1000, direction: 45 * 60000, blur: 0, color: null })
    expect(offset.x).toBe(707)
    expect(offset.y).toBe(707)
  })

  it('points straight down at ninety degrees', () => {
    const offset = shadowOffset({ distance: 1000, direction: 90 * 60000, blur: 0, color: null })
    expect(offset.x).toBe(0)
    expect(offset.y).toBe(1000)
  })
})
