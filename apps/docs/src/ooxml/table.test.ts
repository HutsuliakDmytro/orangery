import { describe, expect, it } from 'vitest'
import { compareXml, describeDifferences } from './compare'
import { parseDocument } from './parse-document'
import type { ProseMirrorNodeJson } from './parse-document'
import { serializeParsed } from './serialize-document'
import { parseGrid } from './table'
import { findChild, parseXml, stripDeclaration } from './xml'

function wrap(body: string): string {
  return `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`
}

const cell = (text: string, properties = '') =>
  `<w:tc>${properties === '' ? '' : `<w:tcPr>${properties}</w:tcPr>`}<w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`

const GRID =
  '<w:tblGrid><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/><w:gridCol w:w="2880"/></w:tblGrid>'

const SIMPLE = wrap(
  `<w:tbl>${GRID}<w:tr>${cell('a')}${cell('b')}${cell('c')}</w:tr><w:tr>${cell('d')}${cell('e')}${cell('f')}</w:tr></w:tbl>`,
)

const tableOf = (xml: string): ProseMirrorNodeJson | undefined =>
  parseDocument(xml).doc.content?.find((node) => node.type === 'table')

describe('parseGrid', () => {
  it('reads column widths in points', () => {
    const [table] = parseXml(`<w:tbl>${GRID}</w:tbl>`)
    expect(table && parseGrid(table)).toEqual([144, 144, 144])
  })

  it('returns nothing when there is no grid', () => {
    const [table] = parseXml('<w:tbl/>')
    expect(table && parseGrid(table)).toEqual([])
  })
})

describe('parsing', () => {
  it('produces rows and cells', () => {
    const table = tableOf(SIMPLE)
    expect(table?.content).toHaveLength(2)
    expect(table?.content?.[0]?.content).toHaveLength(3)
  })

  it('keeps cell text', () => {
    const table = tableOf(SIMPLE)
    const first = table?.content?.[0]?.content?.[0]
    expect(JSON.stringify(first)).toContain('a')
  })

  it('reads a horizontal merge as a colspan', () => {
    const table = tableOf(
      wrap(
        `<w:tbl>${GRID}<w:tr>${cell('wide', '<w:gridSpan w:val="2"/>')}${cell('c')}</w:tr></w:tbl>`,
      ),
    )
    expect(table?.content?.[0]?.content?.[0]?.attrs?.['colspan']).toBe(2)
  })

  it('reads a vertical merge chain as a rowspan on the first cell', () => {
    const table = tableOf(
      wrap(
        `<w:tbl>${GRID}` +
          `<w:tr>${cell('tall', '<w:vMerge w:val="restart"/>')}${cell('b')}</w:tr>` +
          `<w:tr>${cell('', '<w:vMerge/>')}${cell('e')}</w:tr>` +
          `<w:tr>${cell('', '<w:vMerge/>')}${cell('h')}</w:tr>` +
          `</w:tbl>`,
      ),
    )

    expect(table?.content?.[0]?.content?.[0]?.attrs?.['rowspan']).toBe(3)
    // The continuation cells are gone from the model, as ProseMirror expects.
    expect(table?.content?.[1]?.content).toHaveLength(1)
  })

  it('treats a bare w:vMerge as a continuation, not a new merge', () => {
    const table = tableOf(
      wrap(
        `<w:tbl>${GRID}` +
          `<w:tr>${cell('x', '<w:vMerge w:val="restart"/>')}</w:tr>` +
          `<w:tr>${cell('', '<w:vMerge/>')}</w:tr>` +
          `</w:tbl>`,
      ),
    )
    expect(table?.content?.[0]?.content?.[0]?.attrs?.['rowspan']).toBe(2)
  })

  it('reads a cell background', () => {
    const table = tableOf(
      wrap(`<w:tbl>${GRID}<w:tr>${cell('x', '<w:shd w:fill="FF7A00"/>')}</w:tr></w:tbl>`),
    )
    expect(table?.content?.[0]?.content?.[0]?.attrs?.['background']).toBe('#FF7A00')
  })

  it('preserves table properties it does not model', () => {
    const table = tableOf(
      wrap(
        `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/></w:tblPr>${GRID}<w:tr>${cell('x')}</w:tr></w:tbl>`,
      ),
    )
    expect(String(table?.attrs?.['tblPr'])).toContain('w:tblStyle')
  })
})

describe('round-trip', () => {
  const roundTrip = (xml: string) => stripDeclaration(serializeParsed(parseDocument(xml)))

  it('leaves a simple table unchanged', () => {
    expect(describeDifferences(compareXml(SIMPLE, roundTrip(SIMPLE)))).toBe('no differences')
  })

  it('leaves a merged table unchanged', () => {
    const merged = wrap(
      `<w:tbl>${GRID}` +
        `<w:tr>${cell('tall', '<w:tcW w:w="2880" w:type="dxa"/><w:vMerge w:val="restart"/>')}${cell('b')}${cell('c')}</w:tr>` +
        `<w:tr>${cell('', '<w:tcW w:w="2880" w:type="dxa"/><w:vMerge/>')}${cell('e')}${cell('f')}</w:tr>` +
        `</w:tbl>`,
    )
    expect(describeDifferences(compareXml(merged, roundTrip(merged)))).toBe('no differences')
  })

  it('keeps cell width and borders we do not model', () => {
    const detailed = wrap(
      `<w:tbl>${GRID}<w:tr>${cell('x', '<w:tcW w:w="2880" w:type="dxa"/><w:tcBorders><w:top w:val="single"/></w:tcBorders>')}</w:tr></w:tbl>`,
    )
    const rewritten = roundTrip(detailed)

    expect(rewritten).toContain('w:tcBorders')
    expect(rewritten).toContain('w:tcW')
  })

  it('keeps table properties across a save', () => {
    const styled = wrap(
      `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/></w:tblPr>${GRID}<w:tr>${cell('x')}</w:tr></w:tbl>`,
    )
    expect(describeDifferences(compareXml(styled, roundTrip(styled)))).toBe('no differences')
  })

  it('writes the grid back in twips', () => {
    const [document] = parseXml(roundTrip(SIMPLE))
    const body = document && findChild(document, 'w:body')
    const table = body && findChild(body, 'w:tbl')
    const grid = table && findChild(table, 'w:tblGrid')

    expect(grid && parseGrid(table)).toEqual([144, 144, 144])
  })

  it('gives an empty cell a paragraph, which Word requires', () => {
    const empty = wrap(`<w:tbl>${GRID}<w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl>`)
    expect(roundTrip(empty)).toContain('<w:tc><w:p/></w:tc>')
  })
})

describe('structural edits', () => {
  it('rebuilds properties when a merge is changed', () => {
    const parsed = parseDocument(
      wrap(
        `<w:tbl>${GRID}` +
          `<w:tr>${cell('tall', '<w:vMerge w:val="restart"/>')}${cell('b')}</w:tr>` +
          `<w:tr>${cell('', '<w:vMerge/>')}${cell('e')}</w:tr>` +
          `</w:tbl>`,
      ),
    )

    // Unmerging is what the split-cell command does to the model.
    const first = parsed.doc.content?.find((node) => node.type === 'table')?.content?.[0]
      ?.content?.[0]
    if (first?.attrs) first.attrs['rowspan'] = 1

    const rewritten = serializeParsed(parsed)
    expect(rewritten).not.toContain('w:vMerge w:val="restart"')
  })

  it('writes a colspan as gridSpan after an edit', () => {
    const parsed = parseDocument(SIMPLE)
    const first = parsed.doc.content?.find((node) => node.type === 'table')?.content?.[0]
      ?.content?.[0]
    if (first?.attrs) first.attrs['colspan'] = 2

    expect(serializeParsed(parsed)).toContain('w:gridSpan w:val="2"')
  })
})
