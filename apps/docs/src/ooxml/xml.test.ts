import { describe, expect, it } from 'vitest'
import {
  attribute,
  attributes,
  buildXml,
  children,
  deserializeNode,
  element,
  findChild,
  findChildren,
  parseXml,
  serializeNode,
  stripDeclaration,
  tagName,
  textNode,
  textValue,
  withDeclaration,
} from './xml'

describe('round-trip fidelity', () => {
  it('preserves attribute order', () => {
    const xml = '<w:p w:rsidR="00A" w:rsidRDefault="00B" w14:paraId="123"/>'
    expect(buildXml(parseXml(xml))).toBe(xml)
  })

  it('preserves sibling order and repeated elements', () => {
    const xml = '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r></w:p>'
    expect(buildXml(parseXml(xml))).toBe(xml)
  })

  it('keeps significant whitespace inside w:t', () => {
    const xml = '<w:t xml:space="preserve">  spaced  </w:t>'
    expect(buildXml(parseXml(xml))).toBe(xml)
  })

  it('does not coerce numeric-looking attribute values', () => {
    const [node] = parseXml('<w:sz w:val="0"/>')
    expect(node && attribute(node, 'w:val')).toBe('0')
  })

  it('does not coerce boolean-looking attribute values', () => {
    const [node] = parseXml('<w:b w:val="false"/>')
    expect(node && attribute(node, 'w:val')).toBe('false')
  })

  it('preserves entities', () => {
    const xml = '<w:t>a &amp; b &lt; c</w:t>'
    expect(buildXml(parseXml(xml))).toBe(xml)
  })

  it('keeps self-closing elements self-closing', () => {
    const xml = '<w:br w:type="page"/>'
    expect(buildXml(parseXml(xml))).toBe(xml)
  })

  it('round-trips a realistic paragraph unchanged', () => {
    const xml =
      '<w:p w:rsidR="001"><w:pPr><w:pStyle w:val="Heading1"/><w:jc w:val="center"/></w:pPr>' +
      '<w:r><w:rPr><w:b/><w:sz w:val="28"/></w:rPr><w:t xml:space="preserve">Title </w:t></w:r></w:p>'
    expect(buildXml(parseXml(xml))).toBe(xml)
  })
})

describe('node helpers', () => {
  const [paragraph] = parseXml(
    '<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>x</w:t></w:r><w:r><w:t>y</w:t></w:r></w:p>',
  )

  it('reads the tag name', () => {
    expect(paragraph && tagName(paragraph)).toBe('w:p')
  })

  it('lists children in order', () => {
    const tags = paragraph ? children(paragraph).map(tagName) : []
    expect(tags).toEqual(['w:pPr', 'w:r', 'w:r'])
  })

  it('finds the first child by tag', () => {
    const pPr = paragraph && findChild(paragraph, 'w:pPr')
    expect(pPr && tagName(pPr)).toBe('w:pPr')
  })

  it('finds all children by tag', () => {
    expect(paragraph ? findChildren(paragraph, 'w:r') : []).toHaveLength(2)
  })

  it('strips the attribute prefix', () => {
    const [node] = parseXml('<w:pStyle w:val="Heading1"/>')
    expect(node && attributes(node)).toEqual({ 'w:val': 'Heading1' })
  })

  it('returns an empty map for an element without attributes', () => {
    const [node] = parseXml('<w:b/>')
    expect(node && attributes(node)).toEqual({})
  })
})

describe('element builder', () => {
  it('builds an element with attributes in insertion order', () => {
    const node = element('w:sz', { 'w:val': '24' })
    expect(serializeNode(node)).toBe('<w:sz w:val="24"/>')
  })

  it('omits undefined attributes', () => {
    const node = element('w:p', { 'w:rsidR': undefined })
    expect(serializeNode(node)).toBe('<w:p/>')
  })

  it('nests children', () => {
    const node = element('w:r', {}, [element('w:t', {}, [textNode('hi')])])
    expect(serializeNode(node)).toBe('<w:r><w:t>hi</w:t></w:r>')
  })

  it('reads a text value back', () => {
    const [node] = parseXml('<w:t>hello</w:t>')
    const text = node ? children(node)[0] : undefined
    expect(text && textValue(text)).toBe('hello')
  })
})

describe('passthrough serialisation', () => {
  it('survives a serialise/deserialise cycle byte for byte', () => {
    const xml =
      '<w:sdt><w:sdtPr><w:id w:val="99"/></w:sdtPr><w:sdtContent><w:p/></w:sdtContent></w:sdt>'
    const node = deserializeNode(xml)
    expect(node).not.toBeNull()
    expect(node && serializeNode(node)).toBe(xml)
  })

  it('returns null for unparseable input', () => {
    expect(deserializeNode('')).toBeNull()
  })
})

describe('declaration', () => {
  it('adds the declaration Word writes, including CRLF', () => {
    expect(withDeclaration('<a/>')).toBe(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n<a/>',
    )
  })

  it('strips a declaration back off', () => {
    expect(stripDeclaration(withDeclaration('<a/>'))).toBe('<a/>')
  })

  it('leaves declaration-free XML alone', () => {
    expect(stripDeclaration('<a/>')).toBe('<a/>')
  })
})
