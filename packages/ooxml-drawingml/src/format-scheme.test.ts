import { parseXml } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import { fillForReference, lineForReference, readFormatScheme } from './format-scheme'

function node(xml: string): XmlNode {
  const parsed = parseXml(xml)[0]
  if (parsed === undefined) throw new Error(`not parseable: ${xml}`)
  return parsed
}

const scheme = readFormatScheme(
  node(
    '<a:fmtScheme name="Office">' +
      '<a:fillStyleLst>' +
      '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>' +
      '<a:gradFill><a:gsLst><a:gs pos="0"><a:schemeClr val="phClr"/></a:gs></a:gsLst></a:gradFill>' +
      '<a:noFill/>' +
      '</a:fillStyleLst>' +
      '<a:lnStyleLst><a:ln w="6350"/><a:ln w="12700"/><a:ln w="19050"/></a:lnStyleLst>' +
      '<a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>' +
      '</a:fmtScheme>',
  ),
)

describe('readFormatScheme', () => {
  it('reads the three lists a theme offers', () => {
    expect(scheme.name).toBe('Office')
    expect(scheme.fills.map((fill) => fill.kind)).toEqual(['solid', 'gradient', 'none'])
    expect(scheme.lines.map((line) => line.width)).toEqual([6350, 12700, 19050])
    expect(scheme.backgroundFills).toHaveLength(1)
  })

  it('keeps phClr symbolic, since the reference is what supplies it', () => {
    const first = scheme.fills[0]
    expect(first?.kind === 'solid' ? first.color?.source : null).toEqual({
      kind: 'scheme',
      name: 'phClr',
    })
  })
})

describe('resolving a reference', () => {
  it('indexes from one', () => {
    expect(fillForReference(scheme, { index: 1, color: null })).toBe(scheme.fills[0])
    expect(lineForReference(scheme, { index: 3, color: null })).toBe(scheme.lines[2])
  })

  it('treats zero as no fill rather than the first one', () => {
    // Getting this backwards makes every deliberately transparent shape opaque.
    expect(fillForReference(scheme, { index: 0, color: null })).toBeNull()
    expect(lineForReference(scheme, { index: 0, color: null })).toBeNull()
  })

  it('addresses the background list from 1001', () => {
    expect(fillForReference(scheme, { index: 1001, color: null })).toBe(scheme.backgroundFills[0])
  })

  it('returns null for an index the theme does not have', () => {
    expect(fillForReference(scheme, { index: 9, color: null })).toBeNull()
    expect(fillForReference(scheme, null)).toBeNull()
  })
})
