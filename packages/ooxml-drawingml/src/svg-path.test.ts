import { describe, expect, it } from 'vitest'
import { serializeNode } from '@orangery/ooxml-core'
import { customGeometry, parseSvgPath, UnsupportedPathError } from './svg-path'

/** SVG path data as DrawingML custom geometry. */

const kinds = (data: string) => parseSvgPath(data).map((segment) => segment.kind)

describe('reading path data', () => {
  it('reads a moveto and a lineto', () => {
    expect(parseSvgPath('M 1 2 L 3 4')).toEqual([
      { kind: 'move', to: { x: 1, y: 2 } },
      { kind: 'line', to: { x: 3, y: 4 } },
    ])
  })

  it('treats the points after a moveto as lines, which is how polygons are written', () => {
    expect(kinds('M0 0 10 0 10 10Z')).toEqual(['move', 'line', 'line', 'close'])
  })

  it('resolves relative commands against where it is', () => {
    expect(parseSvgPath('M 10 10 l 5 0 l 0 5')).toEqual([
      { kind: 'move', to: { x: 10, y: 10 } },
      { kind: 'line', to: { x: 15, y: 10 } },
      { kind: 'line', to: { x: 15, y: 15 } },
    ])
  })

  it('moves along one axis for H and V, absolute or not', () => {
    expect(parseSvgPath('M 5 5 H 20 V 30 h -5 v -10')).toEqual([
      { kind: 'move', to: { x: 5, y: 5 } },
      { kind: 'line', to: { x: 20, y: 5 } },
      { kind: 'line', to: { x: 20, y: 30 } },
      { kind: 'line', to: { x: 15, y: 30 } },
      { kind: 'line', to: { x: 15, y: 20 } },
    ])
  })

  it('goes back to the start of the subpath on close', () => {
    const segments = parseSvgPath('M 5 5 L 10 10 Z l 1 0')
    expect(segments.at(-1)).toEqual({ kind: 'line', to: { x: 6, y: 5 } })
  })

  it('reads a cubic', () => {
    expect(parseSvgPath('M0 0 C 1 2 3 4 5 6')[1]).toEqual({
      kind: 'cubic',
      first: { x: 1, y: 2 },
      second: { x: 3, y: 4 },
      to: { x: 5, y: 6 },
    })
  })

  it('turns the shorthand into the curve it stands for', () => {
    // S reflects the previous second control point through the current point.
    const segments = parseSvgPath('M0 0 C 1 1 2 2 3 3 S 5 5 6 6')
    expect(segments[2]).toEqual({
      kind: 'cubic',
      first: { x: 4, y: 4 },
      second: { x: 5, y: 5 },
      to: { x: 6, y: 6 },
    })
  })

  it('reads a quadratic and its shorthand', () => {
    const segments = parseSvgPath('M0 0 Q 2 2 4 0 T 8 0')
    expect(segments[1]).toEqual({ kind: 'quad', control: { x: 2, y: 2 }, to: { x: 4, y: 0 } })
    expect(segments[2]).toEqual({ kind: 'quad', control: { x: 6, y: -2 }, to: { x: 8, y: 0 } })
  })

  it('repeats a command for every group of numbers after it', () => {
    expect(kinds('M0 0 L 1 1 2 2 3 3')).toEqual(['move', 'line', 'line', 'line'])
  })

  it('refuses an arc rather than guessing how close is close enough', () => {
    expect(() => parseSvgPath('M0 0 A 5 5 0 0 1 10 10')).toThrow(UnsupportedPathError)
  })

  it('reads nothing out of nothing', () => {
    expect(parseSvgPath('')).toEqual([])
  })
})

describe('building the geometry', () => {
  it('writes the elements PowerPoint reads a path from', () => {
    const xml = serializeNode(customGeometry(['M0 0 L 24 0 L 24 24 Z'], 24))

    expect(xml).toContain('<a:custGeom>')
    expect(xml).toContain('<a:path w="24" h="24">')
    expect(xml).toContain('<a:moveTo><a:pt x="0" y="0"/></a:moveTo>')
    expect(xml).toContain('<a:lnTo><a:pt x="24" y="0"/></a:lnTo>')
    expect(xml).toContain('<a:close/>')
  })

  it('carries the parts of the element the schema wants', () => {
    // Without them PowerPoint offers to repair the file.
    const xml = serializeNode(customGeometry(['M0 0 L 1 1'], 24))

    for (const tag of ['a:avLst', 'a:gdLst', 'a:ahLst', 'a:cxnLst', 'a:rect', 'a:pathLst']) {
      expect(xml).toContain(tag)
    }
  })

  it('writes a path for each outline, so a hole stays a hole', () => {
    const xml = serializeNode(customGeometry(['M0 0 L 24 0 Z', 'M6 6 L 18 6 Z'], 24))
    expect(xml.match(/<a:path /gu)).toHaveLength(2)
  })

  it('rounds to whole units, which is what a coordinate is', () => {
    expect(serializeNode(customGeometry(['M0.4 0.6 L 1.5 2.5'], 24))).toContain(
      '<a:pt x="0" y="1"/>',
    )
  })

  it('writes the curves as the curves they are', () => {
    const xml = serializeNode(customGeometry(['M0 0 C 1 2 3 4 5 6 Q 7 8 9 10'], 24))

    expect(xml).toContain('a:cubicBezTo')
    expect(xml).toContain('a:quadBezTo')
  })
})
