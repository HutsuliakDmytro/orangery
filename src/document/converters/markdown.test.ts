import { describe, expect, it } from 'vitest'
import { escapeMarkdown, parseInline, parseMarkdown, serializeMarkdown } from './markdown'
import type { ProseMirrorNodeJson } from '../../ooxml/parse-document'

const first = (text: string): ProseMirrorNodeJson | undefined =>
  parseMarkdown(text).doc.content?.[0]

describe('block parsing', () => {
  it('parses headings at every level', () => {
    for (let level = 1; level <= 6; level += 1) {
      const node = first(`${'#'.repeat(level)} Title`)
      expect(node?.type).toBe('heading')
      expect(node?.attrs?.['level']).toBe(level)
    }
  })

  it('does not treat a hash without a space as a heading', () => {
    expect(first('#NotAHeading')?.type).toBe('paragraph')
  })

  it('parses a bulleted list', () => {
    const node = first('- one\n- two')
    expect(node?.type).toBe('bulletList')
    expect(node?.content).toHaveLength(2)
  })

  it('accepts all three bullet markers', () => {
    expect(first('* one')?.type).toBe('bulletList')
    expect(first('+ one')?.type).toBe('bulletList')
  })

  it('parses a numbered list', () => {
    expect(first('1. one\n2. two')?.type).toBe('orderedList')
  })

  it('starts a new list when the marker type changes', () => {
    const { doc } = parseMarkdown('- one\n1. two')
    expect(doc.content?.map((node) => node.type)).toEqual(['bulletList', 'orderedList'])
  })

  it('parses a blockquote', () => {
    expect(first('> quoted')?.type).toBe('blockquote')
  })

  it('parses horizontal rules in all three spellings', () => {
    expect(first('---')?.type).toBe('horizontalRule')
    expect(first('***')?.type).toBe('horizontalRule')
    expect(first('___')?.type).toBe('horizontalRule')
  })

  it('drops blank lines between blocks', () => {
    expect(parseMarkdown('one\n\ntwo').doc.content).toHaveLength(2)
  })

  it('produces a paragraph for empty input', () => {
    expect(parseMarkdown('').doc.content).toHaveLength(1)
  })
})

describe('parseInline', () => {
  const marksOf = (text: string) =>
    parseInline(text).flatMap((node) => (node.marks ?? []).map((mark) => mark.type))

  it('parses bold in both spellings', () => {
    expect(marksOf('**bold**')).toContain('bold')
    expect(marksOf('__bold__')).toContain('bold')
  })

  it('parses italic in both spellings', () => {
    expect(marksOf('*slanted*')).toContain('italic')
    expect(marksOf('_slanted_')).toContain('italic')
  })

  it('parses strikethrough', () => {
    expect(marksOf('~~gone~~')).toContain('strike')
  })

  it('parses inline code', () => {
    expect(marksOf('`snippet`')).toContain('code')
  })

  it('parses a link and keeps its target', () => {
    const [node] = parseInline('[text](https://example.com)')
    expect(node?.text).toBe('text')
    expect(node?.marks?.[0]?.attrs?.['href']).toBe('https://example.com')
  })

  it('keeps surrounding plain text', () => {
    const nodes = parseInline('before **bold** after')
    expect(nodes.map((node) => node.text)).toEqual(['before ', 'bold', ' after'])
  })

  it('leaves text with no markup as a single node', () => {
    expect(parseInline('just words')).toHaveLength(1)
  })

  it('does not treat an unmatched asterisk as markup', () => {
    expect(parseInline('2 * 3 = 6').map((node) => node.text)).toEqual(['2 * 3 = 6'])
  })
})

describe('escapeMarkdown', () => {
  it('escapes characters that would be read as markup', () => {
    expect(escapeMarkdown('a*b')).toBe('a\\*b')
    expect(escapeMarkdown('[link]')).toBe('\\[link\\]')
  })

  it('leaves ordinary text alone', () => {
    expect(escapeMarkdown('plain text')).toBe('plain text')
  })
})

describe('serializeMarkdown', () => {
  const roundTrip = (text: string) => serializeMarkdown(parseMarkdown(text).doc)

  it('round-trips headings', () => {
    expect(roundTrip('## Section')).toBe('## Section')
  })

  it('round-trips a bulleted list', () => {
    expect(roundTrip('- one\n- two')).toBe('- one\n\n- two')
  })

  it('renumbers an ordered list from one', () => {
    expect(roundTrip('3. a\n4. b')).toBe('1. a\n\n2. b')
  })

  it('round-trips inline marks', () => {
    expect(roundTrip('**bold** and *slanted*')).toBe('**bold** and *slanted*')
  })

  it('round-trips a link', () => {
    expect(roundTrip('[text](https://example.com)')).toBe('[text](https://example.com)')
  })

  it('writes a rule for a page break, which Markdown cannot express', () => {
    expect(serializeMarkdown({ type: 'doc', content: [{ type: 'pageBreak' }] })).toBe('---')
  })

  it('omits content it cannot represent rather than emitting HTML', () => {
    const doc = {
      type: 'doc',
      content: [{ type: 'passthroughBlock', attrs: { xml: '<w:tbl/>', tag: 'w:tbl' } }],
    }
    expect(serializeMarkdown(doc)).toBe('')
  })

  it('drops formatting Markdown has no syntax for', () => {
    const doc: ProseMirrorNodeJson = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          attrs: { textAlign: 'center' },
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'textStyle', attrs: { color: '#FF0000' } }],
            },
          ],
        },
      ],
    }
    expect(serializeMarkdown(doc)).toBe('x')
  })
})
