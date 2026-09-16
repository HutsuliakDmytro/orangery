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

  it('round-trips a bulleted list', () => {
    const rtf = serializeRtf({ type: 'doc', content: [list('bulletList', ['one', 'two'])] })
    const { doc } = parseRtf(rtf)

    expect(doc.content?.[0]?.type).toBe('bulletList')
    expect(doc.content?.[0]?.content).toHaveLength(2)
    // The marker itself must not end up in the text.
    expect(textContentOf(doc)).toBe('onetwo')
  })

  it('round-trips a numbered list, keeping where it starts', () => {
    const numbered = list('orderedList', ['a', 'b'])
    numbered.attrs = { start: 3 }

    const { doc } = parseRtf(serializeRtf({ type: 'doc', content: [numbered] }))

    expect(doc.content?.[0]?.type).toBe('orderedList')
    expect(doc.content?.[0]?.attrs?.['start']).toBe(3)
  })

  it('round-trips a nested list', () => {
    const outer = list('bulletList', ['outer'])
    outer.content?.[0]?.content?.push(list('bulletList', ['inner']))

    const { doc } = parseRtf(serializeRtf({ type: 'doc', content: [outer] }))

    const item = doc.content?.[0]?.content?.[0]
    expect(item?.content?.[1]?.type).toBe('bulletList')
    expect(textContentOf(item?.content?.[1] ?? { type: 'x' })).toBe('inner')
  })

  it('reads a list another writer marked with a level control word', () => {
    const { doc } = parseRtf(
      "{\\rtf1\\ansi\\pard\\li720\\ls1\\ilvl0{\\listtext\\f0 \\'b7\\tab}One\\par" +
        "\\pard\\li1440\\ls1\\ilvl1{\\listtext\\f0 \\'b7\\tab}Deep\\par}",
    )

    const item = doc.content?.[0]?.content?.[0]
    expect(doc.content?.[0]?.type).toBe('bulletList')
    expect(item?.content?.[1]?.type).toBe('bulletList')
  })

  it('reads a numbered marker as a numbered list', () => {
    const { doc } = parseRtf(
      '{\\rtf1\\ansi\\pard\\li720\\ls1\\ilvl0{\\listtext\\f0 1.\\tab}One\\par}',
    )

    expect(doc.content?.[0]?.type).toBe('orderedList')
  })

  it('reads a lettered marker as a numbered list too', () => {
    const { doc } = parseRtf(
      '{\\rtf1\\ansi\\pard\\li720{\\listtext\\f0 a)\\tab}One\\par}',
    )

    expect(doc.content?.[0]?.type).toBe('orderedList')
  })

  it('ends the list at the first paragraph without a marker', () => {
    const rtf =
      "{\\rtf1\\ansi\\pard\\li720{\\listtext\\f0 \\'b7\\tab}Item\\par\\pard After\\par}"
    const { doc } = parseRtf(rtf)

    expect(doc.content?.[0]?.type).toBe('bulletList')
    expect(doc.content?.[1]?.type).toBe('paragraph')
    expect(textContentOf(doc.content?.[1] ?? { type: 'x' })).toBe('After')
  })

  it('leaves an indented paragraph with no marker as a paragraph', () => {
    const { doc } = parseRtf('{\\rtf1\\ansi\\pard\\li720 Just indented\\par}')

    expect(doc.content?.[0]?.type).toBe('paragraph')
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

describe('rtf pictures', () => {
  const PNG =
    'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

  const withImage = (attrs: Record<string, unknown>): ProseMirrorNodeJson => ({
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'image', attrs }] }],
  })

  it('writes the bytes as a hex picture group with its display size', () => {
    const rtf = serializeRtf(withImage({ src: PNG, width: 72, height: 36 }))

    expect(rtf).toContain('{\\pict\\pngblip')
    // RTF states the display size in twips, twenty to the point.
    expect(rtf).toContain('\\picwgoal1440')
    expect(rtf).toContain('\\pichgoal720')
    expect(rtf).toContain('89504e47')
  })

  it('round-trips a picture', () => {
    const { doc } = parseRtf(serializeRtf(withImage({ src: PNG, width: 72, height: 36 })))

    const image = doc.content?.[0]?.content?.[0]
    expect(image?.type).toBe('image')
    expect(image?.attrs?.['src']).toBe(PNG)
    expect(image?.attrs?.['width']).toBe(72)
    expect(image?.attrs?.['height']).toBe(36)
  })

  it('reads a picture Word wrapped in a shape', () => {
    const rtf = '{\\rtf1\\ansi{\\*\\shppict{\\pict\\pngblip\\picwgoal1440 89504e47}}}'
    const { doc } = parseRtf(rtf)

    const image = doc.content?.[0]?.content?.[0]
    expect(image?.type).toBe('image')
    expect(image?.attrs?.['src']).toContain('data:image/png;base64,')
  })

  it('reads the picture only once when a metafile copy sits beside it', () => {
    const rtf =
      '{\\rtf1\\ansi{\\*\\shppict{\\pict\\pngblip 89504e47}}{\\nonshppict{\\pict\\wmetafile8 0102}}}'
    const { doc } = parseRtf(rtf)

    const images = (doc.content?.[0]?.content ?? []).filter((node) => node.type === 'image')
    expect(images).toHaveLength(1)
  })

  it('ignores the whitespace a writer wraps long hex lines with', () => {
    const rtf = '{\\rtf1\\ansi{\\pict\\pngblip\n8950\n4e47\n}}'
    const { doc } = parseRtf(rtf)

    expect(doc.content?.[0]?.content?.[0]?.attrs?.['src']).toBe('data:image/png;base64,iVBORw==')
  })

  it('reports a picture stored in a format it cannot read, rather than dropping it quietly', () => {
    const { doc, warnings } = parseRtf('{\\rtf1\\ansi{\\pict\\wmetafile8 0102}}')

    expect(JSON.stringify(doc)).not.toContain('image')
    expect(warnings.some((warning) => warning.tag === 'pict')).toBe(true)
  })

  it('leaves out a picture no reader could decode instead of writing broken bytes', () => {
    const rtf = serializeRtf(withImage({ src: 'data:image/gif;base64,R0lGOD', width: 10 }))

    expect(rtf).not.toContain('\\pict')
  })

  it('keeps the text around a picture intact', () => {
    const { doc } = parseRtf(
      serializeRtf({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'before' },
              { type: 'image', attrs: { src: PNG, width: 10, height: 10 } },
              { type: 'text', text: 'after' },
            ],
          },
        ],
      }),
    )

    expect(textContentOf(doc)).toBe('beforeafter')
    expect((doc.content?.[0]?.content ?? []).map((node) => node.type)).toEqual([
      'text',
      'image',
      'text',
    ])
  })
})

describe('rtf character formatting', () => {
  const markOf = (doc: ProseMirrorNodeJson, type: string) =>
    doc.content?.[0]?.content?.[0]?.marks?.find((mark) => mark.type === type)

  it('resolves a colour through the colour table', () => {
    const { doc } = parseRtf(
      '{\\rtf1\\ansi{\\colortbl ;\\red255\\green0\\blue0;\\red0\\green0\\blue255;}\\cf2 blue\\par}',
    )

    expect(markOf(doc, 'textStyle')?.attrs?.['color']).toBe('#0000FF')
  })

  it('treats the first colour table entry as the reader default', () => {
    const { doc } = parseRtf('{\\rtf1\\ansi{\\colortbl ;\\red255\\green0\\blue0;}\\cf0 plain\\par}')
    expect(markOf(doc, 'textStyle')).toBeUndefined()
  })

  it('resolves a font through the font table', () => {
    const { doc } = parseRtf(
      '{\\rtf1\\ansi{\\fonttbl{\\f0\\fnil Arial;}{\\f1\\froman Georgia;}}\\f1 text\\par}',
    )

    expect(markOf(doc, 'textStyle')?.attrs?.['fontFamily']).toBe('Georgia')
  })

  it('reads a size stated in half-points', () => {
    const { doc } = parseRtf('{\\rtf1\\ansi\\fs28 text\\par}')
    expect(markOf(doc, 'textStyle')?.attrs?.['fontSize']).toBe(14)
  })

  it('reads a highlight', () => {
    const { doc } = parseRtf(
      '{\\rtf1\\ansi{\\colortbl ;\\red255\\green255\\blue0;}\\highlight1 text\\par}',
    )

    expect(markOf(doc, 'highlight')?.attrs?.['color']).toBe('#FFFF00')
  })

  it('declares in the header the colours and fonts the body turned out to use', () => {
    const rtf = serializeRtf({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'textStyle', attrs: { color: '#FF0000', fontFamily: 'Georgia' } }],
            },
          ],
        },
      ],
    })

    expect(rtf).toContain('{\\colortbl ;\\red255\\green0\\blue0;}')
    expect(rtf).toContain('{\\f1 Georgia;}')
    expect(rtf).toContain('\\cf1 ')
    expect(rtf).toContain('\\f1 ')
  })

  it('declares a colour used twice only once', () => {
    const rtf = serializeRtf({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'a', marks: [{ type: 'textStyle', attrs: { color: '#FF0000' } }] },
            { type: 'text', text: 'b', marks: [{ type: 'textStyle', attrs: { color: '#FF0000' } }] },
          ],
        },
      ],
    })

    expect(rtf.match(/\\red255/gu)).toHaveLength(1)
  })

  it('round-trips colour, family, size and highlight', () => {
    const source: ProseMirrorNodeJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [
                { type: 'textStyle', attrs: { color: '#FF0000', fontFamily: 'Georgia', fontSize: 14 } },
                { type: 'highlight', attrs: { color: '#FFFF00' } },
              ],
            },
          ],
        },
      ],
    }

    const { doc } = parseRtf(serializeRtf(source))
    const attrs = markOf(doc, 'textStyle')?.attrs

    expect(attrs?.['color']).toBe('#FF0000')
    expect(attrs?.['fontFamily']).toBe('Georgia')
    expect(attrs?.['fontSize']).toBe(14)
    expect(markOf(doc, 'highlight')?.attrs?.['color']).toBe('#FFFF00')
  })

  it('resets a run so the formatting does not run on into the next one', () => {
    const { doc } = parseRtf(
      serializeRtf({
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'red', marks: [{ type: 'textStyle', attrs: { color: '#FF0000' } }] },
              { type: 'text', text: 'plain' },
            ],
          },
        ],
      }),
    )

    const second = doc.content?.[0]?.content?.[1]
    expect(second?.text).toBe('plain')
    expect(second?.marks?.some((mark) => mark.type === 'textStyle')).not.toBe(true)
  })
})

describe('rtf alignment', () => {
  it('reads an alignment control word', () => {
    const { doc } = parseRtf('{\\rtf1\\ansi\\pard\\qc centred\\par}')
    expect(doc.content?.[0]?.attrs?.['textAlign']).toBe('center')
  })

  it('does not carry the alignment into the next paragraph', () => {
    const { doc } = parseRtf('{\\rtf1\\ansi\\pard\\qc one\\par\\pard two\\par}')

    expect(doc.content?.[0]?.attrs?.['textAlign']).toBe('center')
    expect(doc.content?.[1]?.attrs?.['textAlign']).toBeUndefined()
  })

  it('round-trips an aligned paragraph and an aligned heading', () => {
    const source: ProseMirrorNodeJson = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { textAlign: 'right' }, content: [{ type: 'text', text: 'a' }] },
        {
          type: 'heading',
          attrs: { level: 2, textAlign: 'center' },
          content: [{ type: 'text', text: 'b' }],
        },
      ],
    }

    const { doc } = parseRtf(serializeRtf(source))

    expect(doc.content?.[0]?.attrs?.['textAlign']).toBe('right')
    expect(doc.content?.[1]?.type).toBe('heading')
    expect(doc.content?.[1]?.attrs?.['textAlign']).toBe('center')
  })
})

describe('rtf paragraph properties', () => {
  it('reads indents and spacing stated in twips', () => {
    const { doc } = parseRtf('{\\rtf1\\ansi\\pard\\li720\\ri240\\fi-360\\sb120\\sa240 x\\par}')

    const attrs = doc.content?.[0]?.attrs
    expect(attrs?.['indentLeft']).toBe(36)
    expect(attrs?.['indentRight']).toBe(12)
    expect(attrs?.['indentFirstLine']).toBe(-18)
    expect(attrs?.['spaceBefore']).toBe(6)
    expect(attrs?.['spaceAfter']).toBe(12)
  })

  it('reads a line height stated as a multiple of a line', () => {
    const { doc } = parseRtf('{\\rtf1\\ansi\\pard\\sl360\\slmult1 x\\par}')
    expect(doc.content?.[0]?.attrs?.['lineHeight']).toBe(1.5)
  })

  it('leaves an exact line height alone, since it depends on the font', () => {
    const { doc } = parseRtf('{\\rtf1\\ansi\\pard\\sl360\\slmult0 x\\par}')
    expect(doc.content?.[0]?.attrs?.['lineHeight']).toBeUndefined()
  })

  it('does not read a list item’s marker indent as the user’s own', () => {
    const { doc } = parseRtf(
      "{\\rtf1\\ansi\\pard\\fi-360\\li720{\\pntext\\f0 \\'b7\\tab}Item\\par}",
    )

    const item = doc.content?.[0]?.content?.[0]?.content?.[0]
    expect(doc.content?.[0]?.type).toBe('bulletList')
    expect(item?.attrs?.['indentLeft']).toBeUndefined()
    expect(item?.attrs?.['indentFirstLine']).toBeUndefined()
  })

  it('round-trips indents, spacing and line height', () => {
    const source: ProseMirrorNodeJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: {
            textAlign: 'center',
            indentLeft: 36,
            indentFirstLine: -18,
            spaceAfter: 6,
            lineHeight: 1.5,
          },
          content: [{ type: 'text', text: 'x' }],
        },
      ],
    }

    const { doc } = parseRtf(serializeRtf(source))
    expect(doc.content?.[0]?.attrs).toEqual(source.content?.[0]?.attrs)
  })

  it('does not carry the spacing into the next paragraph', () => {
    const { doc } = parseRtf('{\\rtf1\\ansi\\pard\\sa240 one\\par\\pard two\\par}')

    expect(doc.content?.[0]?.attrs?.['spaceAfter']).toBe(12)
    expect(doc.content?.[1]?.attrs).toBeUndefined()
  })
})
