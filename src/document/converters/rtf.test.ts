import { describe, expect, it } from 'vitest'
import { escapeRtf, parseRtf, serializeRtf } from './rtf'
import type { ProseMirrorNodeJson } from '../../ooxml/parse-document'
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

describe('rtf lists', () => {
  const list = (type: 'bulletList' | 'orderedList', items: string[]): ProseMirrorNodeJson => ({
    type,
    content: items.map((text) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
    })),
  })

  it('writes a bulleted list as indented paragraphs with a marker', () => {
    const rtf = serializeRtf({ type: 'doc', content: [list('bulletList', ['one', 'two'])] })

    expect(rtf).toContain('\\pnlvlblt')
    expect(rtf).toContain('\\li720')
    expect(rtf).toContain('one')
    expect(rtf).toContain('two')
  })

  it('numbers an ordered list from the value it starts at', () => {
    const numbered = list('orderedList', ['a', 'b'])
    numbered.attrs = { start: 3 }

    const rtf = serializeRtf({ type: 'doc', content: [numbered] })

    expect(rtf).toContain('\\pntext\\f0 3.\\tab')
    expect(rtf).toContain('\\pntext\\f0 4.\\tab')
  })

  it('indents a nested list one level further', () => {
    const outer = list('bulletList', ['outer'])
    outer.content?.[0]?.content?.push(list('bulletList', ['inner']))

    const rtf = serializeRtf({ type: 'doc', content: [outer] })

    expect(rtf).toContain('\\li720')
    expect(rtf).toContain('\\li1440')
  })

  it('does not put the written marker back into the text when read again', () => {
    const rtf = serializeRtf({ type: 'doc', content: [list('bulletList', ['one'])] })
    const { doc } = parseRtf(rtf)

    // The list itself is not rebuilt, but the text must not gain a stray bullet.
    expect(textContentOf(doc)).toBe('one')
  })

  it('ignores the marker text another writer puts in front of an item', () => {
    const { doc } = parseRtf("{\\rtf1\\ansi{\\listtext\\f0 \\'b7\\tab}Item\\par}")
    expect(textContentOf(doc)).toBe('Item')
  })
})

describe('rtf tables', () => {
  const table: ProseMirrorNodeJson = {
    type: 'table',
    content: [
      {
        type: 'tableRow',
        content: [
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'A' }] }] },
          { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'B' }] }] },
        ],
      },
    ],
  }

  it('writes a row with a cell boundary for each column', () => {
    const rtf = serializeRtf({ type: 'doc', content: [table] })

    expect(rtf).toContain('\\trowd')
    expect(rtf).toContain('\\cellx4680')
    expect(rtf).toContain('\\cellx9360')
    expect(rtf).toContain('\\row')
  })

  it('round-trips a table instead of running the cells together', () => {
    const { doc } = parseRtf(serializeRtf({ type: 'doc', content: [table] }))

    const cells = doc.content?.[0]?.content?.[0]?.content
    expect(doc.content?.[0]?.type).toBe('table')
    expect(cells).toHaveLength(2)
    expect(textContentOf(cells?.[0] ?? { type: 'x' })).toBe('A')
    expect(textContentOf(cells?.[1] ?? { type: 'x' })).toBe('B')
  })

  it('reads several rows into one table', () => {
    const rtf =
      '{\\rtf1\\ansi\\trowd\\cellx4680\\cellx9360 a\\cell b\\cell\\row\\trowd\\cellx4680\\cellx9360 c\\cell d\\cell\\row}'
    const { doc } = parseRtf(rtf)

    expect(doc.content?.[0]?.content).toHaveLength(2)
  })

  it('ends the table at the first paragraph that follows it', () => {
    const rtf =
      '{\\rtf1\\ansi\\trowd\\cellx9360 a\\cell\\row\\pard After\\par}'
    const { doc } = parseRtf(rtf)

    expect(doc.content?.[0]?.type).toBe('table')
    expect(doc.content?.[1]?.type).toBe('paragraph')
    expect(textContentOf(doc.content?.[1] ?? { type: 'x' })).toBe('After')
  })

  it('repeats a spanned cell rather than losing a column', () => {
    const spanned: ProseMirrorNodeJson = {
      type: 'table',
      content: [
        {
          type: 'tableRow',
          content: [
            {
              type: 'tableCell',
              attrs: { colspan: 2 },
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'wide' }] }],
            },
          ],
        },
        {
          type: 'tableRow',
          content: [
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
            { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'y' }] }] },
          ],
        },
      ],
    }

    const { doc } = parseRtf(serializeRtf({ type: 'doc', content: [spanned] }))
    expect(doc.content?.[0]?.content?.[0]?.content).toHaveLength(2)
  })
})
