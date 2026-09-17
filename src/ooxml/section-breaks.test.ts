import { describe, expect, it } from 'vitest'
import { parseDocument } from './parse-document'
import { serializeDocument } from './serialize-document'

/**
 * A section ends at the paragraph whose properties carry its `w:sectPr`; the
 * last section's live on the body. Reading that back as a block of its own is
 * what makes a break visible, and folding it away again is what keeps the file
 * saying the same thing.
 */

const wrap = (body: string) =>
  `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

const sectPr = (orientation = 'landscape') =>
  `<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="${orientation}"/></w:sectPr>`

const write = (xml: string) =>
  serializeDocument(parseDocument(xml).doc, {
    documentAttributes: {},
    sectionProperties: null,
    alwaysPreserveSpace: false,
  })

describe('reading a section break', () => {
  it('lifts it out of the paragraph into a block of its own', () => {
    const { doc } = parseDocument(
      wrap(`<w:p><w:pPr>${sectPr()}</w:pPr><w:r><w:t>one</w:t></w:r></w:p>`),
    )

    expect(doc.content?.map((node) => node.type)).toEqual(['paragraph', 'sectionBreak'])
    expect(doc.content?.[1]?.attrs?.['sectPr']).toContain('w:orient="landscape"')
  })

  it('leaves the paragraph its own text and properties', () => {
    const { doc } = parseDocument(
      wrap(`<w:p><w:pPr><w:jc w:val="center"/>${sectPr()}</w:pPr><w:r><w:t>one</w:t></w:r></w:p>`),
    )

    expect(doc.content?.[0]?.attrs?.['textAlign']).toBe('center')
    expect(doc.content?.[0]?.attrs?.['sectionBreak']).toBeUndefined()
  })

  it('does not leave the section in the preserved properties', () => {
    // Kept there as well, it would be written back twice and the document would
    // gain a section on every save.
    const { doc } = parseDocument(
      wrap(`<w:p><w:pPr>${sectPr()}</w:pPr><w:r><w:t>one</w:t></w:r></w:p>`),
    )

    expect(JSON.stringify(doc.content?.[0]?.attrs)).not.toContain('sectPr')
  })

  it('reads a document with no breaks as it always did', () => {
    const { doc } = parseDocument(wrap('<w:p><w:r><w:t>one</w:t></w:r></w:p>'))
    expect(doc.content?.map((node) => node.type)).toEqual(['paragraph'])
  })
})

describe('writing a section break back', () => {
  it('folds it into the paragraph in front of it', () => {
    const source = wrap(`<w:p><w:pPr>${sectPr()}</w:pPr><w:r><w:t>one</w:t></w:r></w:p>`)
    const xml = write(source)

    expect(xml).toContain('<w:pPr><w:sectPr>')
    expect(xml.match(/<w:p>/gu)).toHaveLength(1)
  })

  it('writes it once, however many times the document is saved', () => {
    const source = wrap(`<w:p><w:pPr>${sectPr()}</w:pPr><w:r><w:t>one</w:t></w:r></w:p>`)
    const twice = write(write(source))

    expect(twice.match(/<w:sectPr>/gu)).toHaveLength(1)
  })

  it('keeps the rest of the paragraph properties beside it', () => {
    const source = wrap(
      `<w:p><w:pPr><w:jc w:val="center"/>${sectPr()}</w:pPr><w:r><w:t>one</w:t></w:r></w:p>`,
    )
    const xml = write(source)

    expect(xml).toContain('<w:jc w:val="center"/>')
    expect(xml.indexOf('w:jc')).toBeLessThan(xml.indexOf('w:sectPr'))
  })

  it('gives a break after a table a paragraph to live on', () => {
    // A table cannot carry section properties, and a `w:sectPr` outside a
    // paragraph is not something Word will open.
    const source = wrap(
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>` +
        `<w:p><w:pPr>${sectPr()}</w:pPr></w:p>`,
    )
    const { doc } = parseDocument(source)
    expect(doc.content?.map((node) => node.type)).toEqual(['table', 'paragraph', 'sectionBreak'])

    expect(write(source)).toContain('<w:sectPr>')
  })

  it('round-trips two sections', () => {
    const source = wrap(
      `<w:p><w:pPr>${sectPr('landscape')}</w:pPr><w:r><w:t>one</w:t></w:r></w:p>` +
        `<w:p><w:pPr>${sectPr('portrait')}</w:pPr><w:r><w:t>two</w:t></w:r></w:p>`,
    )

    const { doc } = parseDocument(write(source))
    expect(doc.content?.map((node) => node.type)).toEqual([
      'paragraph',
      'sectionBreak',
      'paragraph',
      'sectionBreak',
    ])
    expect(doc.content?.[1]?.attrs?.['sectPr']).toContain('landscape')
    expect(doc.content?.[3]?.attrs?.['sectPr']).toContain('portrait')
  })
})
