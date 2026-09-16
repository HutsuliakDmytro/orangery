import { describe, expect, it } from 'vitest'
import { escapeHtml, parseHtml, serializeHtml } from './html'
import { textContentOf } from './types'

const first = (html: string) => parseHtml(html).doc.content?.[0]

describe('block parsing', () => {
  it('parses paragraphs', () => {
    expect(first('<p>hello</p>')?.type).toBe('paragraph')
  })

  it('parses headings at every level', () => {
    for (let level = 1; level <= 6; level += 1) {
      const node = first(`<h${String(level)}>Title</h${String(level)}>`)
      expect(node?.attrs?.['level']).toBe(level)
    }
  })

  it('parses lists', () => {
    expect(first('<ul><li>one</li></ul>')?.type).toBe('bulletList')
    expect(first('<ol><li>one</li></ol>')?.type).toBe('orderedList')
  })

  it('parses a table', () => {
    const node = first('<table><tr><td>A</td><td>B</td></tr></table>')
    expect(node?.type).toBe('table')
    expect(node?.content?.[0]?.content).toHaveLength(2)
  })

  it('reads a table with a header row', () => {
    const node = first(
      '<table><thead><tr><th>A</th></tr></thead><tbody><tr><td>1</td></tr></tbody></table>',
    )
    expect(node?.content).toHaveLength(2)
  })

  it('parses blockquotes and rules', () => {
    expect(first('<blockquote><p>q</p></blockquote>')?.type).toBe('blockquote')
    expect(first('<hr>')?.type).toBe('horizontalRule')
  })

  it('unwraps a div that contains blocks', () => {
    const { doc } = parseHtml('<div><p>one</p><p>two</p></div>')
    expect(doc.content).toHaveLength(2)
  })

  it('turns a div of inline content into a paragraph', () => {
    expect(first('<div>bare text</div>')?.type).toBe('paragraph')
  })

  it('produces a paragraph for empty input', () => {
    expect(parseHtml('').doc.content).toHaveLength(1)
  })

  it('ignores whitespace between block elements', () => {
    // Pretty-printed HTML would otherwise gain an empty paragraph between every
    // pair of elements.
    const { doc } = parseHtml('<body>\n  <p>one</p>\n  <p>two</p>\n</body>')
    expect(doc.content).toHaveLength(2)
  })
})

describe('inline parsing', () => {
  const marksOf = (html: string) =>
    (parseHtml(html).doc.content?.[0]?.content ?? []).flatMap((node) =>
      (node.marks ?? []).map((mark) => mark.type),
    )

  it('maps the usual formatting tags', () => {
    expect(marksOf('<p><strong>a</strong></p>')).toContain('bold')
    expect(marksOf('<p><b>a</b></p>')).toContain('bold')
    expect(marksOf('<p><em>a</em></p>')).toContain('italic')
    expect(marksOf('<p><u>a</u></p>')).toContain('underline')
    expect(marksOf('<p><s>a</s></p>')).toContain('strike')
    expect(marksOf('<p><code>a</code></p>')).toContain('code')
    expect(marksOf('<p><sup>a</sup></p>')).toContain('superscript')
  })

  it('nests marks', () => {
    expect(marksOf('<p><strong><em>a</em></strong></p>')).toEqual(
      expect.arrayContaining(['bold', 'italic']),
    )
  })

  it('parses a line break', () => {
    const content = parseHtml('<p>a<br>b</p>').doc.content?.[0]?.content ?? []
    expect(content.some((node) => node.type === 'hardBreak')).toBe(true)
  })
})

describe('sanitisation', () => {
  it('drops script content entirely', () => {
    const { doc } = parseHtml('<p>safe</p><script>alert(1)</script>')
    expect(JSON.stringify(doc)).not.toContain('alert')
  })

  it('drops style content', () => {
    const { doc } = parseHtml('<style>body{color:red}</style><p>safe</p>')
    expect(JSON.stringify(doc)).not.toContain('color:red')
  })

  it('drops a javascript: link but keeps its text', () => {
    const { doc, warnings } = parseHtml('<p><a href="javascript:alert(1)">click</a></p>')
    expect(JSON.stringify(doc)).not.toContain('javascript')
    expect(textContentOf(doc)).toBe('click')
    expect(warnings).toHaveLength(1)
  })

  it('drops a data: link', () => {
    const { doc } = parseHtml('<p><a href="data:text/html,x">click</a></p>')
    expect(JSON.stringify(doc)).not.toContain('data:')
  })

  it('keeps an http link', () => {
    const { doc } = parseHtml('<p><a href="https://example.com">click</a></p>')
    expect(JSON.stringify(doc)).toContain('https://example.com')
  })

  it('ignores event handler attributes', () => {
    const { doc } = parseHtml('<p onclick="alert(1)">text</p>')
    expect(JSON.stringify(doc)).not.toContain('onclick')
    expect(textContentOf(doc)).toBe('text')
  })

  it('ignores inline styles rather than carrying them through', () => {
    const { doc } = parseHtml('<p style="color:red">text</p>')
    expect(JSON.stringify(doc)).not.toContain('color')
  })

  it('drops an iframe', () => {
    const { doc } = parseHtml('<iframe src="https://evil.example"></iframe><p>safe</p>')
    expect(JSON.stringify(doc)).not.toContain('evil')
  })
})

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml('<a & "b">')).toBe('&lt;a &amp; &quot;b&quot;&gt;')
  })
})

describe('serializeHtml', () => {
  it('writes a complete document', () => {
    const html = serializeHtml(parseHtml('<p>hello</p>').doc)
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('<p>hello</p>')
  })

  it('escapes text so content cannot become markup', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '<script>' }] }],
    }
    expect(serializeHtml(doc)).toContain('&lt;script&gt;')
  })

  it('adds rel=noopener to links', () => {
    const html = serializeHtml(parseHtml('<p><a href="https://example.com">x</a></p>').doc)
    expect(html).toContain('rel="noopener noreferrer"')
  })

  it('round-trips structure', () => {
    const original = '<h2>Title</h2><p><strong>bold</strong> text</p><ul><li><p>one</p></li></ul>'
    const html = serializeHtml(parseHtml(original).doc)

    expect(html).toContain('<h2>Title</h2>')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('<ul><li><p>one</p></li></ul>')
  })

  it('writes a table rather than concatenating its cells', () => {
    const html = serializeHtml(parseHtml('<table><tr><td>A</td><td>B</td></tr></table>').doc)
    expect(html).toContain('<table><tbody><tr><td>A</td><td>B</td></tr></tbody></table>')
  })

  it('round-trips a table', () => {
    const doc = parseHtml(
      '<table><tr><td>A</td><td>B</td></tr><tr><td>1</td><td>2</td></tr></table>',
    ).doc
    const again = parseHtml(serializeHtml(doc)).doc
    expect(JSON.stringify(again)).toBe(JSON.stringify(doc))
  })

  it('omits content it cannot represent', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'passthroughBlock', attrs: { xml: '<w:tbl/>', tag: 'w:tbl' } }],
    }
    expect(serializeHtml(doc)).not.toContain('w:tbl')
  })
})

describe('html images', () => {
  const PIXEL = 'data:image/png;base64,iVBORw=='

  it('reads an image with its alt text and size', () => {
    const { doc } = parseHtml(`<p>before<img src="${PIXEL}" alt="A cat" width="96"></p>`)

    const image = doc.content?.[0]?.content?.[1]
    expect(image?.type).toBe('image')
    expect(image?.attrs?.['src']).toBe(PIXEL)
    expect(image?.attrs?.['alt']).toBe('A cat')
    // HTML sizes in pixels, the editor in points.
    expect(image?.attrs?.['width']).toBe(72)
  })

  it('reads an image that stands on its own', () => {
    const { doc } = parseHtml(`<img src="${PIXEL}">`)

    expect(doc.content?.[0]?.type).toBe('paragraph')
    expect(doc.content?.[0]?.content?.[0]?.type).toBe('image')
  })

  it('drops an image whose address could run something, and says so', () => {
    const { doc, warnings } = parseHtml('<p><img src="javascript:alert(1)"></p>')

    expect(JSON.stringify(doc)).not.toContain('javascript')
    expect(warnings.some((warning) => warning.tag === 'img')).toBe(true)
  })

  it('writes an image back', () => {
    const html = serializeHtml({
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'image', attrs: { src: PIXEL, alt: 'A "cat"', width: 72 } }],
        },
      ],
    })

    expect(html).toContain(`<img src="${PIXEL}"`)
    expect(html).toContain('alt="A &quot;cat&quot;"')
    expect(html).toContain('width="96"')
  })

  it('round-trips an image through both directions', () => {
    const { doc } = parseHtml(`<p><img src="${PIXEL}" alt="x" width="48"></p>`)
    const again = parseHtml(serializeHtml(doc))

    expect(again.doc.content?.[0]?.content?.[0]?.attrs?.['src']).toBe(PIXEL)
    expect(again.doc.content?.[0]?.content?.[0]?.attrs?.['width']).toBe(36)
  })
})
