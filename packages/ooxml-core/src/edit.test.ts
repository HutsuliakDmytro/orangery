import { describe, expect, it } from 'vitest'
import { ensureChild, removeAttribute, removeChild, setAttribute, upsertChild } from './edit'
import { attribute, children, element, parseXml, serializeNode, tagName } from './xml'
import type { XmlNode } from './xml'

function node(xml: string): XmlNode {
  const parsed = parseXml(xml)[0]
  if (parsed === undefined) throw new Error(`not parseable: ${xml}`)
  return parsed
}

/** The schema sequence for `a:spPr`, which is the one this is used on most. */
const SP_PR = ['a:xfrm', 'a:prstGeom', 'a:custGeom', 'a:solidFill', 'a:ln', 'a:effectLst']

describe('attributes', () => {
  it('sets one on an element that had none', () => {
    const element = node('<a:off/>')
    setAttribute(element, 'x', '100')

    expect(attribute(element, 'x')).toBe('100')
  })

  it('replaces one without disturbing its neighbours', () => {
    const element = node('<a:off x="1" y="2"/>')
    setAttribute(element, 'x', '100')

    expect(serializeNode(element)).toBe('<a:off x="100" y="2"/>')
  })

  it('removes one, and does nothing for one that is not there', () => {
    const element = node('<a:ext cx="1" cy="2"/>')
    removeAttribute(element, 'cx')
    removeAttribute(element, 'nope')

    expect(serializeNode(element)).toBe('<a:ext cy="2"/>')
  })
})

describe('upsertChild', () => {
  it('replaces in place, so what was third stays third', () => {
    // A diff of the saved file should show the one thing that changed.
    const properties = node('<a:spPr><a:xfrm/><a:prstGeom prst="rect"/><a:ln/></a:spPr>')
    upsertChild(properties, element('a:prstGeom', { prst: 'ellipse' }), SP_PR)

    expect(children(properties).map((child) => tagName(child))).toEqual([
      'a:xfrm',
      'a:prstGeom',
      'a:ln',
    ])
    expect(serializeNode(properties)).toContain('prst="ellipse"')
  })

  it('inserts a new child where the schema puts it', () => {
    // PowerPoint offers to repair a file whose fill comes before its geometry.
    const properties = node('<a:spPr><a:prstGeom prst="rect"/><a:ln/></a:spPr>')
    upsertChild(properties, element('a:xfrm'), SP_PR)

    expect(children(properties).map((child) => tagName(child))).toEqual([
      'a:xfrm',
      'a:prstGeom',
      'a:ln',
    ])
  })

  it('inserts before the first element that comes after it, not at the end', () => {
    const properties = node('<a:spPr><a:xfrm/><a:ln/></a:spPr>')
    upsertChild(properties, element('a:solidFill'), SP_PR)

    expect(children(properties).map((child) => tagName(child))).toEqual([
      'a:xfrm',
      'a:solidFill',
      'a:ln',
    ])
  })

  it('appends something the schema list does not mention', () => {
    // An element we do not know the position of is left at the end rather than
    // guessed into the middle.
    const properties = node('<a:spPr><a:xfrm/></a:spPr>')
    upsertChild(properties, element('a:extLst'), SP_PR)

    expect(children(properties).map((child) => tagName(child))).toEqual(['a:xfrm', 'a:extLst'])
  })

  it('never jumps over an element it does not know', () => {
    const properties = node('<a:spPr><a:unknownThing/><a:ln/></a:spPr>')
    upsertChild(properties, element('a:solidFill'), SP_PR)

    expect(children(properties).map((child) => tagName(child))).toEqual([
      'a:unknownThing',
      'a:solidFill',
      'a:ln',
    ])
  })
})

describe('ensureChild', () => {
  it('returns the existing one rather than a second', () => {
    const properties = node('<a:spPr><a:xfrm rot="90"/></a:spPr>')
    const xfrm = ensureChild(properties, 'a:xfrm', SP_PR)

    expect(attribute(xfrm, 'rot')).toBe('90')
    expect(children(properties)).toHaveLength(1)
  })

  it('creates one in the right place when there is none', () => {
    const properties = node('<a:spPr><a:prstGeom prst="rect"/></a:spPr>')
    setAttribute(ensureChild(properties, 'a:xfrm', SP_PR), 'rot', '180')

    // Self-closing when empty, which is what PowerPoint writes.
    expect(serializeNode(properties)).toBe(
      '<a:spPr><a:xfrm rot="180"/><a:prstGeom prst="rect"/></a:spPr>',
    )
  })
})

describe('removeChild', () => {
  it('removes every one with that tag', () => {
    const list = node('<a:gsLst><a:gs/><a:gs/><a:other/></a:gsLst>')
    removeChild(list, 'a:gs')

    expect(children(list).map((child) => tagName(child))).toEqual(['a:other'])
  })

  it('does nothing for a tag that is not there', () => {
    const list = node('<a:gsLst><a:gs/></a:gsLst>')
    removeChild(list, 'a:nope')

    expect(children(list)).toHaveLength(1)
  })
})
