import { describe, expect, it } from 'vitest'
import { parseDocument } from './parse-document'
import { serializeDocument } from './serialize-document'

/**
 * A character style names formatting instead of describing it, so losing it
 * loses the link between a run and the style that decides how it looks.
 */

const wrap = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

const run = (rPr: string) => wrap(`<w:p><w:r><w:rPr>${rPr}</w:rPr><w:t>x</w:t></w:r></w:p>`)

const write = (xml: string) =>
  serializeDocument(parseDocument(xml).doc, {
    documentAttributes: {},
    sectionProperties: null,
    alwaysPreserveSpace: false,
  })

const marksOf = (xml: string) =>
  (parseDocument(xml).doc.content?.[0]?.content?.[0]?.marks ?? []).map((mark) => mark.type)

describe('reading a character style', () => {
  it('becomes a mark of its own', () => {
    expect(marksOf(run('<w:rStyle w:val="Emphasis"/>'))).toContain('characterStyle')
  })

  it('carries the name of the style', () => {
    const marks = parseDocument(run('<w:rStyle w:val="Emphasis"/>')).doc.content?.[0]?.content?.[0]
      ?.marks
    const style = marks?.find((mark) => mark.type === 'characterStyle')

    expect(style?.attrs?.['styleId']).toBe('Emphasis')
  })

  it('sits beside the formatting the run states as well', () => {
    expect(marksOf(run('<w:rStyle w:val="Emphasis"/><w:b/>'))).toEqual(
      expect.arrayContaining(['characterStyle', 'bold']),
    )
  })
})

describe('writing it back', () => {
  it('survives a round-trip', () => {
    expect(write(run('<w:rStyle w:val="Emphasis"/>'))).toContain('<w:rStyle w:val="Emphasis"/>')
  })

  it('comes first, as the schema requires', () => {
    const parsed = parseDocument(run('<w:rStyle w:val="Emphasis"/><w:b/>'))
    // Touched, so the properties are rebuilt rather than written back verbatim.
    const text = parsed.doc.content?.[0]?.content?.[0]
    text?.marks?.push({ type: 'italic' })

    const xml = serializeDocument(parsed.doc, {
      documentAttributes: {},
      sectionProperties: null,
      alwaysPreserveSpace: false,
    })

    expect(xml.indexOf('w:rStyle')).toBeLessThan(xml.indexOf('<w:b/>'))
  })
})

describe('run properties that are not modelled', () => {
  it('keeps the language of the run', () => {
    // Word spell-checks and hyphenates by it, so a run that loses it is checked
    // against the wrong language.
    expect(write(run('<w:lang w:val="uk-UA"/>'))).toContain('w:lang')
  })

  it('keeps the flag that turns proofing off', () => {
    expect(write(run('<w:noProof/>'))).toContain('w:noProof')
  })
})
