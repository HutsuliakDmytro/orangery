import { describe, expect, it } from 'vitest'
import { escapeRtf, parseRtf, serializeRtf } from './rtf'
import { textContentOf } from './types'

const DOCUMENT = (body: string) => `{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Arial;}}\n${body}\n}`

describe('parseRtf', () => {
  it('reads plain paragraphs', () => {
    const { doc } = parseRtf(DOCUMENT('\\pard one\\par\\pard two\\par'))
    expect(doc.content).toHaveLength(2)
    expect(textContentOf(doc)).toBe('onetwo')
  })

  it('skips the font table rather than treating it as text', () => {
    const { doc } = parseRtf(DOCUMENT('\\pard hello\\par'))
    expect(textContentOf(doc)).toBe('hello')
    expect(textContentOf(doc)).not.toContain('Arial')
  })

  it('skips a colour table', () => {
    const { doc } = parseRtf(DOCUMENT('{\\colortbl;\\red255\\green0\\blue0;}\\pard hello\\par'))
    expect(textContentOf(doc)).toBe('hello')
  })

  it('skips an ignorable destination', () => {
    const { doc } = parseRtf(DOCUMENT('{\\*\\generator Word;}\\pard hello\\par'))
    expect(textContentOf(doc)).toBe('hello')
  })

  it('reads bold and italic', () => {
    const { doc } = parseRtf(DOCUMENT('\\pard \\b bold\\b0  plain\\par'))
    const marks = (doc.content?.[0]?.content ?? []).map((node) =>
      (node.marks ?? []).map((mark) => mark.type),
    )
    expect(marks[0]).toContain('bold')
    expect(marks[1] ?? []).toEqual([])
  })

  it('reads underline and strikethrough', () => {
    const { doc } = parseRtf(DOCUMENT('\\pard \\ul under\\ulnone \\strike gone\\strike0\\par'))
    const types = (doc.content?.[0]?.content ?? []).flatMap((node) =>
      (node.marks ?? []).map((mark) => mark.type),
    )
    expect(types).toContain('underline')
    expect(types).toContain('strike')
  })

  it('reads a heading from its outline level', () => {
    const { doc } = parseRtf(DOCUMENT('\\pard\\outlinelevel1 Section\\par'))
    expect(doc.content?.[0]?.type).toBe('heading')
    expect(doc.content?.[0]?.attrs?.['level']).toBe(2)
  })

  it('unescapes literal braces and backslashes', () => {
    const { doc } = parseRtf(DOCUMENT('\\pard a\\{b\\}c\\\\d\\par'))
    expect(textContentOf(doc)).toBe('a{b}c\\d')
  })

  it('decodes a hex escape', () => {
    const { doc } = parseRtf(DOCUMENT("\\pard caf\\'e9\\par"))
    expect(textContentOf(doc)).toBe('café')
  })

  it('reads a tab', () => {
    const { doc } = parseRtf(DOCUMENT('\\pard a\\tab b\\par'))
    expect(textContentOf(doc)).toBe('a\tb')
  })

  it('reads a page break', () => {
    const { doc } = parseRtf(DOCUMENT('\\pard\\page\\par'))
    expect(JSON.stringify(doc)).toContain('pageBreak')
  })

  it('resets formatting on pard', () => {
    const { doc } = parseRtf(DOCUMENT('\\pard\\b bold\\par\\pard plain\\par'))
    const second = doc.content?.[1]?.content?.[0]
    expect(second?.marks ?? []).toEqual([])
  })

  it('warns when the input is not RTF at all', () => {
    expect(parseRtf('just some text').warnings).toHaveLength(1)
  })

  it('does not throw on truncated input', () => {
    expect(() => parseRtf('{\\rtf1\\ansi \\b unterminated')).not.toThrow()
  })

  it('produces a paragraph for empty input', () => {
    expect(parseRtf('').doc.content).toHaveLength(1)
  })

  it('decodes a unicode escape', () => {
    expect(textContentOf(parseRtf(DOCUMENT('\\pard \\u233?\\par')).doc)).toBe('é')
  })

  it('does not emit the fallback character alongside the real one', () => {
    expect(textContentOf(parseRtf(DOCUMENT('\\pard a\\u233?b\\par')).doc)).toBe('aéb')
  })

  it('honours a \\uc declaration of more than one fallback character', () => {
    expect(textContentOf(parseRtf(DOCUMENT('\\pard \\uc2 \\u233??x\\par')).doc)).toBe('éx')
  })

  it('reads a code unit written as a negative number', () => {
    // RTF writes code units as signed 16-bit, so anything above 32767 is negative.
    expect(textContentOf(parseRtf(DOCUMENT('\\pard \\u-10179?\\par')).doc)).toBe('\ud83d')
  })

  it('recombines a surrogate pair into one character', () => {
    expect(textContentOf(parseRtf(DOCUMENT('\\pard \\u55357?\\u56397?\\par')).doc)).toBe('👍')
  })
})

describe('escapeRtf', () => {
  it('escapes braces and backslashes', () => {
    expect(escapeRtf('a{b}c\\d')).toBe('a\\{b\\}c\\\\d')
  })

  it('leaves ASCII alone', () => {
    expect(escapeRtf('plain text')).toBe('plain text')
  })

  it('escapes non-ASCII as unicode control words', () => {
    expect(escapeRtf('é')).toBe('\\u233?')
  })

  it('escapes Cyrillic', () => {
    expect(escapeRtf('я')).toBe('\\u1103?')
  })

  it('escapes an astral character as a surrogate pair', () => {
    expect(escapeRtf('👍')).toBe('\\u55357?\\u56397?')
  })

  it('writes a tab as a control word', () => {
    expect(escapeRtf('a\tb')).toBe('a\\tab b')
  })
})

describe('serializeRtf', () => {
  const roundTrip = (rtf: string) => textContentOf(parseRtf(serializeRtf(parseRtf(rtf).doc)).doc)

  it('writes a valid RTF header', () => {
    expect(serializeRtf({ type: 'doc', content: [] }).startsWith('{\\rtf1\\ansi')).toBe(true)
  })

  it('round-trips plain text', () => {
    expect(roundTrip(DOCUMENT('\\pard hello world\\par'))).toBe('hello world')
  })

  it('round-trips non-ASCII text', () => {
    expect(
      roundTrip(DOCUMENT('\\pard \\u1055?\\u1088?\\u1080?\\u1074?\\u1110?\\u1090?\\par')),
    ).toBe('Привіт')
  })

  it('round-trips bold', () => {
    const doc = parseRtf(serializeRtf(parseRtf(DOCUMENT('\\pard \\b bold\\b0\\par')).doc)).doc
    const marks = (doc.content?.[0]?.content?.[0]?.marks ?? []).map((mark) => mark.type)
    expect(marks).toContain('bold')
  })

  it('round-trips a heading', () => {
    const doc = parseRtf(
      serializeRtf(parseRtf(DOCUMENT('\\pard\\outlinelevel0 Title\\par')).doc),
    ).doc
    expect(doc.content?.[0]?.type).toBe('heading')
    expect(doc.content?.[0]?.attrs?.['level']).toBe(1)
  })

  it('omits content it cannot represent', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'passthroughBlock', attrs: { xml: '<w:tbl/>', tag: 'w:tbl' } }],
    }
    expect(serializeRtf(doc)).not.toContain('w:tbl')
  })
})
