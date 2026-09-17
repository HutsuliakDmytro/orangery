import { describe, expect, it } from 'vitest'
import { parseDocument } from './parse-document'
import { serializeDocument } from './serialize-document'

/**
 * A tracked change says what somebody did to the text. Losing it loses who
 * changed what, which is the only thing a document under review is for.
 */

const wrap = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

const reviewed = wrap(
  '<w:p>' +
    '<w:r><w:t>kept </w:t></w:r>' +
    '<w:ins w:id="1" w:author="Ada" w:date="2026-09-17T10:00:00Z"><w:r><w:t>added</w:t></w:r></w:ins>' +
    '<w:del w:id="2" w:author="Ada" w:date="2026-09-17T10:01:00Z"><w:r><w:delText>removed</w:delText></w:r></w:del>' +
    '</w:p>',
)

const write = (xml: string) =>
  serializeDocument(parseDocument(xml).doc, {
    documentAttributes: {},
    sectionProperties: null,
    alwaysPreserveSpace: false,
  })

const marksOf = (index: number) =>
  (parseDocument(reviewed).doc.content?.[0]?.content?.[index]?.marks ?? []).map((mark) => mark.type)

describe('reading a tracked change', () => {
  it('marks what was added', () => {
    expect(marksOf(1)).toContain('insertion')
  })

  it('marks what was taken out, and keeps its text', () => {
    // A deletion is still shown, struck through, until somebody decides.
    expect(marksOf(2)).toContain('deletion')
    expect(parseDocument(reviewed).doc.content?.[0]?.content?.[2]?.text).toBe('removed')
  })

  it('leaves the untouched text alone', () => {
    expect(marksOf(0)).not.toContain('insertion')
  })

  it('carries who made the change and when', () => {
    const marks = parseDocument(reviewed).doc.content?.[0]?.content?.[1]?.marks
    const insertion = marks?.find((mark) => mark.type === 'insertion')

    expect(insertion?.attrs?.['author']).toBe('Ada')
    expect(insertion?.attrs?.['date']).toBe('2026-09-17T10:00:00Z')
  })
})

describe('writing it back', () => {
  it('wraps the run rather than marking it', () => {
    const xml = write(reviewed)

    expect(xml).toContain('<w:ins w:id="1" w:author="Ada"')
    expect(xml).toContain('<w:del w:id="2" w:author="Ada"')
  })

  it('writes deleted text as deleted text', () => {
    // A `w:t` inside `w:del` is text the reader shows as still present, which
    // is the opposite of what the change says.
    const xml = write(reviewed)

    expect(xml).toContain('<w:delText>removed</w:delText>')
    expect(xml).not.toContain('<w:t>removed</w:t>')
  })

  it('round-trips without gaining or losing a change', () => {
    expect(write(write(reviewed))).toBe(write(reviewed))
  })

  it('leaves a document with no changes without either element', () => {
    const plain = wrap('<w:p><w:r><w:t>text</w:t></w:r></w:p>')

    expect(write(plain)).not.toContain('w:ins')
    expect(write(plain)).not.toContain('w:del')
  })
})

describe('a change of formatting', () => {
  it('is kept as it was read, even though nothing here models it', () => {
    const source = wrap(
      '<w:p><w:r><w:rPr><w:b/>' +
        '<w:rPrChange w:id="3" w:author="Ada" w:date="2026-01-01T00:00:00Z"><w:rPr/></w:rPrChange>' +
        '</w:rPr><w:t>x</w:t></w:r></w:p>',
    )

    expect(write(source)).toContain('w:rPrChange')
  })

  it('is written from what the editor recorded', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [
                { type: 'bold' },
                {
                  type: 'formatChange',
                  attrs: {
                    revisionId: '7',
                    author: 'Ada',
                    date: '2026-01-01T00:00:00Z',
                    previous: '[{"type":"italic","attrs":{}}]',
                  },
                },
              ],
            },
          ],
        },
      ],
    }

    const xml = serializeDocument(doc, {
      documentAttributes: {},
      sectionProperties: null,
      alwaysPreserveSpace: false,
    })

    // The run says how it looks now, and then what it looked like before.
    expect(xml).toContain('<w:b/>')
    expect(xml).toContain('<w:rPrChange w:id="7" w:author="Ada"')
    expect(xml).toContain('<w:i/>')
    expect(xml.indexOf('<w:b/>')).toBeLessThan(xml.indexOf('w:rPrChange'))
  })

  it('writes an empty record for text that had no formatting before', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [
                { type: 'bold' },
                { type: 'formatChange', attrs: { revisionId: '1', author: 'Ada', previous: '[]' } },
              ],
            },
          ],
        },
      ],
    }

    // An empty `w:rPr` is meaningful: it says the text carried nothing of its
    // own, which is what taking formatting off records.
    expect(
      serializeDocument(doc, {
        documentAttributes: {},
        sectionProperties: null,
        alwaysPreserveSpace: false,
      }),
    ).toContain('<w:rPrChange w:id="1" w:author="Ada"><w:rPr/></w:rPrChange>')
  })
})
