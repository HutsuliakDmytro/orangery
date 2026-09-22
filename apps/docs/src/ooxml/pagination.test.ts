import { describe, expect, it } from 'vitest'
import { parseDocument } from './parse-document'
import { serializeDocument } from './serialize-document'

const wrap = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

const paragraph = (pPr: string) => wrap(`<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)

const attrsOf = (xml: string) => parseDocument(xml).doc.content?.[0]?.attrs ?? {}

const write = (xml: string) =>
  serializeDocument(parseDocument(xml).doc, {
    documentAttributes: {},
    sectionProperties: null,
  })

describe('pagination properties', () => {
  it('reads a toggle that is present as on', () => {
    const attrs = attrsOf(paragraph('<w:keepNext/><w:keepLines/><w:pageBreakBefore/>'))

    expect(attrs['keepNext']).toBe(true)
    expect(attrs['keepLines']).toBe(true)
    expect(attrs['pageBreakBefore']).toBe(true)
  })

  it('reads an explicit off as off, not as unset', () => {
    // Word turns widow control on by default, so a paragraph that switches it
    // off is saying something and must not come back as "not specified".
    expect(attrsOf(paragraph('<w:widowControl w:val="0"/>'))['widowControl']).toBe(false)
  })

  it('leaves a paragraph that says nothing without the attributes', () => {
    const attrs = attrsOf(paragraph('<w:jc w:val="center"/>'))

    expect(attrs['keepNext']).toBeUndefined()
    expect(attrs['widowControl']).toBeUndefined()
  })

  it('writes a paragraph back unchanged when nothing was edited', () => {
    const source = paragraph('<w:keepNext/><w:widowControl w:val="0"/>')
    expect(write(source)).toContain('<w:keepNext/><w:widowControl w:val="0"/>')
  })

  it('rebuilds the toggles when the paragraph changed', () => {
    const parsed = parseDocument(paragraph('<w:keepNext/>'))
    const block = parsed.doc.content?.[0]
    if (block?.attrs) {
      block.attrs['keepLines'] = true
      block.attrs['widowControl'] = false
    }

    const xml = serializeDocument(parsed.doc, {
      documentAttributes: {},
      sectionProperties: null,
    })

    expect(xml).toContain('<w:keepNext/>')
    expect(xml).toContain('<w:keepLines/>')
    expect(xml).toContain('<w:widowControl w:val="0"/>')
  })

  it('keeps the order OOXML requires for the properties it rebuilds', () => {
    const parsed = parseDocument(
      paragraph('<w:pStyle w:val="Heading1"/><w:keepNext/><w:jc w:val="center"/>'),
    )
    const block = parsed.doc.content?.[0]
    if (block?.attrs) block.attrs['spaceAfter'] = 6

    const xml = serializeDocument(parsed.doc, {
      documentAttributes: {},
      sectionProperties: null,
    })

    // The toggles sit between the style and the spacing, which is where the
    // schema puts them; out of order, Word offers to repair the file.
    const order = ['w:pStyle', 'w:keepNext', 'w:spacing', 'w:jc'].map((tag) => xml.indexOf(tag))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('round-trips every toggle', () => {
    const source = paragraph(
      '<w:keepNext/><w:keepLines w:val="0"/><w:pageBreakBefore/><w:widowControl w:val="0"/>',
    )

    expect(attrsOf(write(source))).toEqual(attrsOf(source))
  })

  it('does not duplicate a toggle into the preserved markup', () => {
    const parsed = parseDocument(paragraph('<w:keepNext/>'))
    expect(parsed.doc.content?.[0]?.attrs?.['preservedPPr']).toBeUndefined()
  })
})
