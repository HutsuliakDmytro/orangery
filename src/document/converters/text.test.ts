import { describe, expect, it } from 'vitest'
import { parseText, serializeText } from './text'

describe('parseText', () => {
  it('turns each line into a paragraph', () => {
    const { doc } = parseText('one\ntwo')
    expect(doc.content).toHaveLength(2)
  })

  it('keeps blank lines as empty paragraphs', () => {
    const { doc } = parseText('one\n\ntwo')
    expect(doc.content).toHaveLength(3)
    expect(doc.content?.[1]?.content).toBeUndefined()
  })

  it('accepts CRLF line endings', () => {
    expect(parseText('one\r\ntwo').doc.content).toHaveLength(2)
  })

  it('accepts lone CR line endings', () => {
    expect(parseText('one\rtwo').doc.content).toHaveLength(2)
  })

  it('does not add a paragraph for a trailing newline', () => {
    expect(parseText('one\ntwo\n').doc.content).toHaveLength(2)
  })

  it('produces one empty paragraph for empty input', () => {
    const { doc } = parseText('')
    expect(doc.content).toHaveLength(1)
  })
})

describe('serializeText', () => {
  it('writes one line per paragraph', () => {
    expect(serializeText(parseText('one\ntwo').doc)).toBe('one\ntwo')
  })

  it('round-trips text with blank lines', () => {
    const original = 'one\n\ntwo\n\n\nthree'
    expect(serializeText(parseText(original).doc)).toBe(original)
  })

  it('writes a form feed for a page break', () => {
    const doc = { type: 'doc', content: [{ type: 'pageBreak' }] }
    expect(serializeText(doc)).toBe('\f')
  })

  it('skips content it cannot represent rather than writing markup', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'passthroughBlock', attrs: { xml: '<w:tbl/>', tag: 'w:tbl' } }],
    }
    expect(serializeText(doc)).toBe('')
  })

  it('flattens formatting, since plain text has none', () => {
    const doc = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'bold', marks: [{ type: 'bold' }] }],
        },
      ],
    }
    expect(serializeText(doc)).toBe('bold')
  })
})
