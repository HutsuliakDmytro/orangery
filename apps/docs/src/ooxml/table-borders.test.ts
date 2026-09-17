import {
  compareXml,
  describeDifferences,
  findChild,
  parseXml,
  serializeNode,
  tagName,
} from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import {
  bordersFrom,
  borderToCss,
  eighthsToPoints,
  parseBorders,
  pointsToEighths,
  serializeBorders,
  uniformBorders,
  withBorders,
} from './table-borders'

const TBL_PR =
  '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' +
  '<w:tblBorders>' +
  '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
  '<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
  '<w:bottom w:val="double" w:sz="12" w:space="0" w:color="FF7A00"/>' +
  '<w:insideH w:val="dashed" w:sz="4" w:space="0" w:color="auto"/>' +
  '</w:tblBorders>' +
  '<w:tblLook w:val="04A0"/></w:tblPr>'

describe('width units', () => {
  it('converts eighths of a point to points', () => {
    expect(eighthsToPoints(4)).toBe(0.5)
    expect(eighthsToPoints(12)).toBe(1.5)
  })

  it('converts back', () => {
    expect(pointsToEighths(0.5)).toBe(4)
    expect(pointsToEighths(1.5)).toBe(12)
  })

  it('never produces a negative width', () => {
    expect(pointsToEighths(-3)).toBe(0)
  })
})

describe('parseBorders', () => {
  const borders = bordersFrom(TBL_PR)

  it('reads each declared edge', () => {
    expect(Object.keys(borders).sort()).toEqual(['bottom', 'insideH', 'left', 'top'])
  })

  it('reads the style', () => {
    expect(borders.bottom?.style).toBe('double')
    expect(borders.insideH?.style).toBe('dashed')
  })

  it('reads the width in points', () => {
    expect(borders.top?.width).toBe(0.5)
    expect(borders.bottom?.width).toBe(1.5)
  })

  it('reads the colour', () => {
    expect(borders.bottom?.color).toBe('#FF7A00')
  })

  it('treats auto as no colour', () => {
    expect(borders.insideH?.color).toBeNull()
  })

  it('returns nothing for properties without borders', () => {
    expect(bordersFrom('<w:tblPr><w:tblStyle w:val="x"/></w:tblPr>')).toEqual({})
    expect(bordersFrom(null)).toEqual({})
  })

  it('ignores an element that is not a known edge', () => {
    const odd = parseBorders(parseXml('<w:tblBorders><w:nonsense w:val="x"/></w:tblBorders>')[0])
    expect(odd).toEqual({})
  })
})

describe('serializeBorders', () => {
  it('writes the edges in the order OOXML requires', () => {
    const xml = serializeNode(
      serializeBorders({
        insideV: { style: 'single', width: 0.5, color: null },
        top: { style: 'single', width: 0.5, color: null },
      }) ?? {},
    )
    expect(xml.indexOf('w:top')).toBeLessThan(xml.indexOf('w:insideV'))
  })

  it('writes the width in eighths', () => {
    const xml = serializeNode(
      serializeBorders({ top: { style: 'single', width: 1.5, color: null } }) ?? {},
    )
    expect(xml).toContain('w:sz="12"')
  })

  it('writes auto for no colour', () => {
    const xml = serializeNode(
      serializeBorders({ top: { style: 'single', width: 0.5, color: null } }) ?? {},
    )
    expect(xml).toContain('w:color="auto"')
  })

  it('returns null for an empty set', () => {
    expect(serializeBorders({})).toBeNull()
  })

  it('round-trips a border set', () => {
    const before = bordersFrom(TBL_PR)
    const after = parseBorders(serializeBorders(before) ?? undefined)
    expect(after).toEqual(before)
  })
})

describe('withBorders', () => {
  const applied = withBorders(
    TBL_PR,
    uniformBorders({ style: 'dotted', width: 1, color: '#333333' }),
  )

  it('replaces the borders', () => {
    expect(bordersFrom(applied).top?.style).toBe('dotted')
    expect(bordersFrom(applied).insideV?.width).toBe(1)
  })

  it('keeps every other table property', () => {
    expect(applied).toContain('w:tblStyle')
    expect(applied).toContain('w:tblW')
    expect(applied).toContain('w:tblLook')
  })

  it('puts the borders after the width and before the look', () => {
    // OOXML fixes the order of `w:tblPr` children; Word rejects a file that
    // declares them out of sequence.
    expect(applied.indexOf('w:tblW')).toBeLessThan(applied.indexOf('w:tblBorders'))
    expect(applied.indexOf('w:tblBorders')).toBeLessThan(applied.indexOf('w:tblLook'))
  })

  it('creates the properties when a table had none', () => {
    const created = withBorders(null, uniformBorders({ style: 'single', width: 0.5, color: null }))
    const node = parseXml(created)[0]

    expect(node && tagName(node)).toBe('w:tblPr')
    expect(node && findChild(node, 'w:tblBorders')).toBeDefined()
  })

  it('leaves the properties alone when they cannot be parsed', () => {
    expect(withBorders('<nonsense/>', {})).toBe('<nonsense/>')
  })

  it('does not change the rest of the properties structurally', () => {
    const kept = withBorders(TBL_PR, bordersFrom(TBL_PR))
    expect(describeDifferences(compareXml(TBL_PR, kept))).toBe('no differences')
  })
})

describe('borderToCss', () => {
  it('maps the styles CSS has', () => {
    expect(borderToCss({ style: 'double', width: 1.5, color: '#000000' })).toBe(
      '1.5pt double #000000',
    )
    expect(borderToCss({ style: 'dashed', width: 0.5, color: null })).toContain('dashed')
  })

  it('falls back to solid for a style CSS lacks', () => {
    expect(borderToCss({ style: 'wave', width: 0.5, color: null })).toContain('solid')
  })

  it('gives a thick border a visible minimum width', () => {
    expect(borderToCss({ style: 'thick', width: 0.25, color: null })).toContain('1.5pt')
  })

  it('renders none as none', () => {
    expect(borderToCss({ style: 'none', width: 0, color: null })).toBe('none')
    expect(borderToCss(undefined)).toBe('none')
  })
})
