import { getPartText } from '@orangery/ooxml-core'
import { DOCUMENT_PART, readDocxPackage } from './parts'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDocument } from './parse-document'
import type { ProseMirrorNodeJson } from './parse-document'

const FIXTURES = join(process.cwd(), 'tests/fixtures/docx/synthetic')

async function parseFixture(name: string) {
  const pkg = await readDocxPackage(await readFile(join(FIXTURES, `${name}.docx`)))
  return parseDocument(getPartText(pkg, DOCUMENT_PART) ?? '')
}

function wrap(body: string): string {
  return `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
}

function textOf(node: ProseMirrorNodeJson): string {
  if (node.text !== undefined) return node.text
  return (node.content ?? []).map(textOf).join('')
}

describe('paragraphs and runs', () => {
  it('parses plain text into paragraphs', () => {
    const { doc } = parseDocument(wrap('<w:p><w:r><w:t>hello</w:t></w:r></w:p>'))
    expect(doc.content?.[0]?.type).toBe('paragraph')
    expect(textOf(doc.content?.[0] as ProseMirrorNodeJson)).toBe('hello')
  })

  it('merges adjacent runs into one paragraph', () => {
    const { doc } = parseDocument(wrap('<w:p><w:r><w:t>a</w:t></w:r><w:r><w:t>b</w:t></w:r></w:p>'))
    expect(doc.content).toHaveLength(1)
    expect(textOf(doc.content?.[0] as ProseMirrorNodeJson)).toBe('ab')
  })

  it('keeps whitespace marked with xml:space', () => {
    const { doc } = parseDocument(
      wrap('<w:p><w:r><w:t xml:space="preserve"> pad </w:t></w:r></w:p>'),
    )
    expect(textOf(doc.content?.[0] as ProseMirrorNodeJson)).toBe(' pad ')
  })

  it('produces a paragraph even for an empty body', () => {
    const { doc } = parseDocument(wrap(''))
    expect(doc.content).toHaveLength(1)
  })
})

describe('run properties', () => {
  const marksOf = (xml: string) => {
    const { doc } = parseDocument(wrap(`<w:p><w:r><w:rPr>${xml}</w:rPr><w:t>x</w:t></w:r></w:p>`))
    const text = doc.content?.[0]?.content?.[0]
    return (text?.marks ?? []).map((mark) => mark.type)
  }

  it('maps bold, italic and strike', () => {
    expect(marksOf('<w:b/><w:i/><w:strike/>')).toEqual(
      expect.arrayContaining(['bold', 'italic', 'strike']),
    )
  })

  it('respects an explicit off toggle', () => {
    expect(marksOf('<w:b w:val="0"/>')).not.toContain('bold')
  })

  it('treats underline none as not underlined', () => {
    expect(marksOf('<w:u w:val="none"/>')).not.toContain('underline')
    expect(marksOf('<w:u w:val="single"/>')).toContain('underline')
  })

  it('maps vertical alignment to super and subscript', () => {
    expect(marksOf('<w:vertAlign w:val="superscript"/>')).toContain('superscript')
    expect(marksOf('<w:vertAlign w:val="subscript"/>')).toContain('subscript')
  })

  it('converts half-points to points', () => {
    const { doc } = parseDocument(
      wrap('<w:p><w:r><w:rPr><w:sz w:val="28"/></w:rPr><w:t>x</w:t></w:r></w:p>'),
    )
    const textStyle = doc.content?.[0]?.content?.[0]?.marks?.find((m) => m.type === 'textStyle')
    expect(textStyle?.attrs?.['fontSize']).toBe(14)
  })

  it('converts a colour to hex', () => {
    const { doc } = parseDocument(
      wrap('<w:p><w:r><w:rPr><w:color w:val="ff7a00"/></w:rPr><w:t>x</w:t></w:r></w:p>'),
    )
    const textStyle = doc.content?.[0]?.content?.[0]?.marks?.find((m) => m.type === 'textStyle')
    expect(textStyle?.attrs?.['color']).toBe('#FF7A00')
  })

  it('preserves run properties it does not model', () => {
    const { doc } = parseDocument(
      wrap('<w:p><w:r><w:rPr><w:effect w:val="blinkBackground"/></w:rPr><w:t>x</w:t></w:r></w:p>'),
    )
    const preserved = doc.content?.[0]?.content?.[0]?.marks?.find(
      (m) => m.type === 'preservedRunProperties',
    )
    expect(preserved?.attrs?.['xml']).toContain('w:effect')
  })
})

describe('paragraph properties', () => {
  const attrsOf = (xml: string) => {
    const { doc } = parseDocument(wrap(`<w:p><w:pPr>${xml}</w:pPr><w:r><w:t>x</w:t></w:r></w:p>`))
    return doc.content?.[0]?.attrs ?? {}
  }

  it('maps a heading style to a heading node', () => {
    const { doc } = parseDocument(
      wrap('<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>'),
    )
    expect(doc.content?.[0]?.type).toBe('heading')
    expect(doc.content?.[0]?.attrs?.['level']).toBe(2)
  })

  it('maps OOXML "both" alignment to justify', () => {
    expect(attrsOf('<w:jc w:val="both"/>')['textAlign']).toBe('justify')
  })

  it('converts line spacing from 240ths of a line', () => {
    expect(attrsOf('<w:spacing w:line="276" w:lineRule="auto"/>')['lineHeight']).toBe(1.15)
  })

  it('does not approximate exact line spacing into a multiplier', () => {
    expect(attrsOf('<w:spacing w:line="360" w:lineRule="exact"/>')['lineHeight']).toBeUndefined()
  })

  it('converts spacing before and after from twips', () => {
    const attrs = attrsOf('<w:spacing w:before="240" w:after="120"/>')
    expect(attrs['spaceBefore']).toBe(12)
    expect(attrs['spaceAfter']).toBe(6)
  })

  it('converts indentation from twips', () => {
    expect(attrsOf('<w:ind w:left="720"/>')['indentLeft']).toBe(36)
  })

  it('reads a hanging indent as a negative first line', () => {
    expect(attrsOf('<w:ind w:hanging="360"/>')['indentFirstLine']).toBe(-18)
  })

  it('reads numbering references', () => {
    const numbering = attrsOf('<w:numPr><w:ilvl w:val="1"/><w:numId w:val="3"/></w:numPr>')[
      'numbering'
    ]
    expect(numbering).toEqual({ numId: 3, level: 1 })
  })

  it('preserves paragraph properties it does not model', () => {
    expect(attrsOf('<w:pBdr><w:top w:val="single"/></w:pBdr>')['preservedPPr']).toContain('w:pBdr')
  })
})

describe('breaks and links', () => {
  it('maps a page break to its own node', () => {
    const { doc } = parseDocument(wrap('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'))
    expect(doc.content?.[0]?.content?.[0]?.type).toBe('pageBreak')
  })

  it('maps a plain break to a hard break', () => {
    const { doc } = parseDocument(wrap('<w:p><w:r><w:br/></w:r></w:p>'))
    expect(doc.content?.[0]?.content?.[0]?.type).toBe('hardBreak')
  })

  it('marks hyperlink text with a link', () => {
    const { doc } = parseDocument(
      wrap('<w:p><w:hyperlink r:id="rId5"><w:r><w:t>click</w:t></w:r></w:hyperlink></w:p>'),
    )
    const marks = doc.content?.[0]?.content?.[0]?.marks ?? []
    expect(marks.some((mark) => mark.type === 'link')).toBe(true)
  })
})

describe('unknown content', () => {
  it('preserves an unknown block and warns rather than throwing', () => {
    const { doc, warnings } = parseDocument(wrap('<w:sdt><w:sdtContent/></w:sdt>'))
    expect(doc.content?.[0]?.type).toBe('passthroughBlock')
    expect(doc.content?.[0]?.attrs?.['xml']).toContain('w:sdt')
    expect(warnings.map((w) => w.tag)).toContain('w:sdt')
  })

  it('preserves unknown inline content', () => {
    const { doc } = parseDocument(wrap('<w:p><w:fldSimple w:instr="PAGE"/></w:p>'))
    expect(doc.content?.[0]?.content?.[0]?.type).toBe('passthroughInline')
  })

  it('keeps section properties out of the body content', () => {
    const { doc, sectionProperties } = parseDocument(
      wrap('<w:p><w:r><w:t>x</w:t></w:r></w:p><w:sectPr><w:pgSz w:w="12240"/></w:sectPr>'),
    )
    expect(doc.content).toHaveLength(1)
    expect(sectionProperties).toContain('w:pgSz')
  })

  it('does not throw on malformed input', () => {
    expect(() => parseDocument('<not-a-document/>')).not.toThrow()
    expect(parseDocument('<not-a-document/>').warnings).not.toHaveLength(0)
  })
})

describe('real fixtures', () => {
  it('parses every synthetic fixture without warnings about paragraphs', async () => {
    const { doc, warnings } = await parseFixture('plain-paragraphs')
    expect(doc.content?.length).toBeGreaterThan(1)
    expect(warnings).toEqual([])
  })

  it('parses headings into heading nodes', async () => {
    const { doc } = await parseFixture('headings')
    expect(doc.content?.some((node) => node.type === 'heading')).toBe(true)
  })

  it('parses tables into editable table nodes', async () => {
    const { doc } = await parseFixture('tables')
    const table = doc.content?.find((node) => node.type === 'table')

    expect(table).toBeDefined()
    expect(table?.content?.[0]?.type).toBe('tableRow')
    expect(table?.content?.[0]?.content?.[0]?.type).toBe('tableCell')
  })

  it('reads merged cells as spans rather than continuation cells', async () => {
    const { doc } = await parseFixture('tables')
    const cells = (doc.content ?? [])
      .filter((node) => node.type === 'table')
      .flatMap((table) => table.content ?? [])
      .flatMap((row) => row.content ?? [])

    const span = (cell: ProseMirrorNodeJson, key: string): number => {
      const value = cell.attrs?.[key]
      return typeof value === 'number' ? value : 1
    }

    expect(cells.some((cell) => span(cell, 'colspan') > 1)).toBe(true)
    expect(cells.some((cell) => span(cell, 'rowspan') > 1)).toBe(true)
  })

  it('reads section properties from a real document', async () => {
    const { sectionProperties } = await parseFixture('sections-page-setup')
    expect(sectionProperties).toContain('w:pgSz')
  })
})
