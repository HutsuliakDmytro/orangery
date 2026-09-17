import { describe, expect, it } from 'vitest'
import { nextCommentId, parseComments, serializeComments } from './comments'
import type { Comment } from './comments'
import { parseDocument } from './parse-document'
import { serializeDocument } from './serialize-document'

const PART = `<?xml version="1.0"?>
<w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:comment w:id="0" w:author="Ada" w:initials="AL" w:date="2026-09-17T10:00:00Z">
    <w:p><w:r><w:t>Needs a source.</w:t></w:r></w:p>
  </w:comment>
</w:comments>`

const comment = (overrides: Partial<Comment> = {}): Comment => ({
  id: 0,
  author: 'Ada',
  initials: 'AL',
  date: '2026-09-17T10:00:00Z',
  text: 'Needs a source.',
  ...overrides,
})

const wrap = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

const write = (xml: string) =>
  serializeDocument(parseDocument(xml).doc, {
    documentAttributes: {},
    sectionProperties: null,
    alwaysPreserveSpace: false,
  })

describe('the comments part', () => {
  it('reads who wrote it and what it says', () => {
    const found = parseComments(PART).get(0)

    expect(found?.author).toBe('Ada')
    expect(found?.initials).toBe('AL')
    expect(found?.text).toBe('Needs a source.')
  })

  it('reads a comment of several paragraphs as several lines', () => {
    const xml = PART.replace(
      '<w:p><w:r><w:t>Needs a source.</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>One.</w:t></w:r></w:p><w:p><w:r><w:t>Two.</w:t></w:r></w:p>',
    )

    expect(parseComments(xml).get(0)?.text).toBe('One.\nTwo.')
  })

  it('round-trips through the writer', () => {
    const comments = new Map([[0, comment()]])
    expect(parseComments(serializeComments(comments)).get(0)).toEqual(comment())
  })

  it('has nothing to read in a document with no comments part', () => {
    expect(parseComments('')).toHaveLength(0)
  })

  it('hands out an id nothing is using', () => {
    expect(nextCommentId(new Map())).toBe(0)
    expect(nextCommentId(new Map([[0, comment()]]))).toBe(1)
  })
})

describe('where a comment applies', () => {
  const anchored = wrap(
    '<w:p>' +
      '<w:commentRangeStart w:id="0"/>' +
      '<w:r><w:t>commented</w:t></w:r>' +
      '<w:commentRangeEnd w:id="0"/>' +
      '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="0"/></w:r>' +
      '<w:r><w:t> plain</w:t></w:r>' +
      '</w:p>',
  )

  const marksOf = (index: number) =>
    (parseDocument(anchored).doc.content?.[0]?.content?.[index]?.marks ?? []).map(
      (mark) => mark.type,
    )

  it('marks the text the range covers', () => {
    expect(marksOf(0)).toContain('comment')
  })

  it('leaves the text after the range alone', () => {
    expect(marksOf(1)).not.toContain('comment')
  })

  it('does not show the reference run as text', () => {
    // Word draws the bubble from it; inline it is a marker, not content.
    expect(parseDocument(anchored).doc.content?.[0]?.content).toHaveLength(2)
  })

  it('carries the id, so the text and the comment can find each other', () => {
    const marks = parseDocument(anchored).doc.content?.[0]?.content?.[0]?.marks
    expect(marks?.find((mark) => mark.type === 'comment')?.attrs?.['commentId']).toBe(0)
  })

  it('writes the markers back around the same text', () => {
    const xml = write(anchored)

    expect(xml).toContain('<w:commentRangeStart w:id="0"/>')
    expect(xml).toContain('<w:commentRangeEnd w:id="0"/>')
    expect(xml).toContain('<w:commentReference w:id="0"/>')
    expect(xml.indexOf('commentRangeStart')).toBeLessThan(xml.indexOf('commentRangeEnd'))
  })

  it('writes the reference once, not once per run', () => {
    expect(write(anchored).match(/commentReference/gu)).toHaveLength(1)
  })

  it('carries a range that spans two paragraphs', () => {
    const across = wrap(
      '<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>first</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>second</w:t></w:r><w:commentRangeEnd w:id="1"/></w:p>',
    )
    const { doc } = parseDocument(across)

    expect(doc.content?.[0]?.content?.[0]?.marks?.some((mark) => mark.type === 'comment')).toBe(true)
    expect(doc.content?.[1]?.content?.[0]?.marks?.some((mark) => mark.type === 'comment')).toBe(true)
  })

  it('closes a range the document left open at the end of its paragraph', () => {
    // An unclosed range would otherwise run to the end of the document.
    const unclosed = wrap(
      '<w:p><w:commentRangeStart w:id="2"/><w:r><w:t>one</w:t></w:r></w:p>' +
        '<w:p><w:r><w:t>two</w:t></w:r></w:p>',
    )

    expect(write(unclosed).match(/commentRangeEnd/gu)).toHaveLength(1)
  })
})

describe('a range that spans paragraphs', () => {
  const across = wrap(
    '<w:p><w:commentRangeStart w:id="1"/><w:r><w:t>first</w:t></w:r></w:p>' +
      '<w:p><w:r><w:t>second</w:t></w:r><w:commentRangeEnd w:id="1"/>' +
      '<w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:commentReference w:id="1"/></w:r></w:p>',
  )

  it('is written as one range, not one per paragraph', () => {
    // Two ranges sharing an id is not what the id means, and Word reads it as
    // two comments where the document has one.
    const xml = write(across)

    expect(xml.match(/commentRangeStart/gu)).toHaveLength(1)
    expect(xml.match(/commentRangeEnd/gu)).toHaveLength(1)
  })

  it('opens in the first paragraph and closes in the last', () => {
    const xml = write(across)
    const paragraphs = xml.split('<w:p>')

    expect(paragraphs[1]).toContain('commentRangeStart')
    expect(paragraphs[2]).toContain('commentRangeEnd')
  })

  it('survives a second round-trip unchanged', () => {
    expect(write(write(across))).toBe(write(across))
  })
})
