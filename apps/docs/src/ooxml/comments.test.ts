import { compareXml, describeDifferences } from '@orangery/ooxml-core'
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
    const read = parseComments(serializeComments(comments)).get(0)

    // What the comment is, rather than the markup it is carrying: a comment
    // read out of a part also brings its paragraphs back with it.
    expect(read).toMatchObject({
      id: 0,
      author: 'Ada',
      initials: 'AL',
      date: '2026-09-17T10:00:00Z',
      text: 'Needs a source.',
    })
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

    expect(doc.content?.[0]?.content?.[0]?.marks?.some((mark) => mark.type === 'comment')).toBe(
      true,
    )
    expect(doc.content?.[1]?.content?.[0]?.marks?.some((mark) => mark.type === 'comment')).toBe(
      true,
    )
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

/**
 * A comment as the file wrote it, not as we would have.
 *
 * `Comment` used to be `{ id, author, initials, date, text }`: the paragraphs
 * were flattened to a string on the way in and rebuilt from it on the way out,
 * with `w:pStyle w:val="CommentText"` and `w:rStyle w:val="CommentReference"`
 * written over whatever the file called them. A document whose styles are
 * named `a5` and `a6` — which is what LibreOffice writes, and Word in several
 * locales — came back renamed, and any formatting inside the comment was gone.
 *
 * 21 files of the full corpus.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/7
 */
describe('a comment written by something that is not us', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const part =
    `<?xml version='1.0' encoding='utf-8'?>\n` +
    `<w:comments xmlns:w="${W}" xmlns:v="urn:schemas-microsoft-com:vml">` +
    `<w:comment w:id="0" w:author="Ada" w:initials="AL" w:date="2026-09-17T10:00:00Z" w:extra="kept">` +
    `<w:p><w:pPr><w:pStyle w:val="a6"/></w:pPr>` +
    `<w:r><w:rPr><w:rStyle w:val="a5"/></w:rPr><w:annotationRef/></w:r>` +
    `<w:r><w:rPr><w:b/></w:rPr><w:t>Needs</w:t></w:r>` +
    `<w:r><w:t xml:space="preserve"> a source.</w:t></w:r>` +
    `</w:p></w:comment></w:comments>`

  const read = () => parseComments(part)

  it('reads the words the panel shows', () => {
    expect(read().get(0)?.text).toBe('Needs a source.')
  })

  it('keeps the style ids the file used', () => {
    const written = serializeComments(read(), part)

    expect(written).toContain('<w:pStyle w:val="a6"/>')
    expect(written).toContain('<w:rStyle w:val="a5"/>')
    expect(written).not.toContain('CommentText')
  })

  it('keeps the formatting inside the comment', () => {
    expect(serializeComments(read(), part)).toContain('<w:b/>')
  })

  it('keeps an attribute of w:comment nobody models', () => {
    expect(serializeComments(read(), part)).toContain('w:extra="kept"')
  })

  it('leaves the part with no differences at all', () => {
    expect(describeDifferences(compareXml(part, serializeComments(read(), part)))).toBe(
      'no differences',
    )
  })

  it('rebuilds only the comment whose words changed', () => {
    const comments = read()
    const first = comments.get(0)
    if (first) comments.set(0, { ...first, text: 'Rewritten.' })

    const written = serializeComments(comments, part)

    expect(written).toContain('Rewritten.')
    expect(written).toContain('CommentText')
    expect(written).not.toContain('<w:b/>')
  })
})

/**
 * The run in the body that carries the reference.
 *
 * Word draws the bubble from it and shows nothing inline, so it is not content
 * and is rebuilt rather than kept — which wrote `w:rStyle w:val`
 * `CommentReference` over whatever the document calls that style.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/7
 */
describe('the reference run of a comment', () => {
  const body =
    '<w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Text</w:t></w:r>' +
    '<w:commentRangeEnd w:id="0"/>' +
    '<w:r><w:rPr><w:rStyle w:val="a5"/></w:rPr><w:commentReference w:id="0"/></w:r></w:p>'

  it('is read off the body and kept by id', () => {
    expect(parseDocument(wrap(body)).commentAnchors['0']).toContain('w:val="a5"')
  })

  it('goes back with the style id the document used', () => {
    const parsed = parseDocument(wrap(body))
    const written = serializeDocument(parsed.doc, {
      documentAttributes: {},
      sectionProperties: null,
      commentAnchors: parsed.commentAnchors,
    })

    expect(written).toContain('<w:rStyle w:val="a5"/>')
    expect(written).not.toContain('CommentReference"')
  })

  it('is written our way for a comment the document did not have', () => {
    const written = serializeDocument(parseDocument(wrap(body)).doc, {
      documentAttributes: {},
      sectionProperties: null,
    })

    expect(written).toContain('<w:rStyle w:val="CommentReference"/>')
  })
})
