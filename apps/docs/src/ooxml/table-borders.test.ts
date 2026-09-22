import {
  compareXml,
  describeDifferences,
  findChild,
  parseXml,
  serializeNode,
  tagName,
} from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import { parseDocument } from './parse-document'
import { serializeParsed } from './serialize-document'
import {
  bordersFrom,
  borderToCss,
  eighthsToPoints,
  parseBorders,
  pointsToEighths,
  serializeBorders,
  uniformBorders,
  withBorders,
} from './table-borders'

const TBL_PR =
  '<w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="0" w:type="auto"/>' +
  '<w:tblBorders>' +
  '<w:top w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
  '<w:left w:val="single" w:sz="4" w:space="0" w:color="000000"/>' +
  '<w:bottom w:val="double" w:sz="12" w:space="0" w:color="FF7A00"/>' +
  '<w:insideH w:val="dashed" w:sz="4" w:space="0" w:color="auto"/>' +
  '</w:tblBorders>' +
  '<w:tblLook w:val="04A0"/></w:tblPr>'

describe('width units', () => {
  it('converts eighths of a point to points', () => {
    expect(eighthsToPoints(4)).toBe(0.5)
    expect(eighthsToPoints(12)).toBe(1.5)
  })

  it('converts back', () => {
    expect(pointsToEighths(0.5)).toBe(4)
    expect(pointsToEighths(1.5)).toBe(12)
  })

  it('never produces a negative width', () => {
    expect(pointsToEighths(-3)).toBe(0)
  })
})

describe('parseBorders', () => {
  const borders = bordersFrom(TBL_PR)

  it('reads each declared edge', () => {
    expect(Object.keys(borders).sort()).toEqual(['bottom', 'insideH', 'left', 'top'])
  })

  it('reads the style', () => {
    expect(borders.bottom?.style).toBe('double')
    expect(borders.insideH?.style).toBe('dashed')
  })

  it('reads the width in points', () => {
    expect(borders.top?.width).toBe(0.5)
    expect(borders.bottom?.width).toBe(1.5)
  })

  it('reads the colour', () => {
    expect(borders.bottom?.color).toBe('#FF7A00')
  })

  it('treats auto as no colour', () => {
    expect(borders.insideH?.color).toBeNull()
  })

  it('returns nothing for properties without borders', () => {
    expect(bordersFrom('<w:tblPr><w:tblStyle w:val="x"/></w:tblPr>')).toEqual({})
    expect(bordersFrom(null)).toEqual({})
  })

  it('ignores an element that is not a known edge', () => {
    const odd = parseBorders(parseXml('<w:tblBorders><w:nonsense w:val="x"/></w:tblBorders>')[0])
    expect(odd).toEqual({})
  })
})

describe('serializeBorders', () => {
  it('writes the edges in the order OOXML requires', () => {
    const xml = serializeNode(
      serializeBorders({
        insideV: { style: 'single', width: 0.5, color: null },
        top: { style: 'single', width: 0.5, color: null },
      }) ?? {},
    )
    expect(xml.indexOf('w:top')).toBeLessThan(xml.indexOf('w:insideV'))
  })

  it('writes the width in eighths', () => {
    const xml = serializeNode(
      serializeBorders({ top: { style: 'single', width: 1.5, color: null } }) ?? {},
    )
    expect(xml).toContain('w:sz="12"')
  })

  it('writes auto for no colour', () => {
    const xml = serializeNode(
      serializeBorders({ top: { style: 'single', width: 0.5, color: null } }) ?? {},
    )
    expect(xml).toContain('w:color="auto"')
  })

  it('returns null for an empty set', () => {
    expect(serializeBorders({})).toBeNull()
  })

  it('round-trips a border set', () => {
    const before = bordersFrom(TBL_PR)
    const after = parseBorders(serializeBorders(before) ?? undefined)
    expect(after).toEqual(before)
  })
})

describe('withBorders', () => {
  const applied = withBorders(
    TBL_PR,
    uniformBorders({ style: 'dotted', width: 1, color: '#333333' }),
  )

  it('replaces the borders', () => {
    expect(bordersFrom(applied).top?.style).toBe('dotted')
    expect(bordersFrom(applied).insideV?.width).toBe(1)
  })

  it('keeps every other table property', () => {
    expect(applied).toContain('w:tblStyle')
    expect(applied).toContain('w:tblW')
    expect(applied).toContain('w:tblLook')
  })

  it('puts the borders after the width and before the look', () => {
    // OOXML fixes the order of `w:tblPr` children; Word rejects a file that
    // declares them out of sequence.
    expect(applied.indexOf('w:tblW')).toBeLessThan(applied.indexOf('w:tblBorders'))
    expect(applied.indexOf('w:tblBorders')).toBeLessThan(applied.indexOf('w:tblLook'))
  })

  it('creates the properties when a table had none', () => {
    const created = withBorders(null, uniformBorders({ style: 'single', width: 0.5, color: null }))
    const node = parseXml(created)[0]

    expect(node && tagName(node)).toBe('w:tblPr')
    expect(node && findChild(node, 'w:tblBorders')).toBeDefined()
  })

  it('leaves the properties alone when they cannot be parsed', () => {
    expect(withBorders('<nonsense/>', {})).toBe('<nonsense/>')
  })

  it('does not change the rest of the properties structurally', () => {
    const kept = withBorders(TBL_PR, bordersFrom(TBL_PR))
    expect(describeDifferences(compareXml(TBL_PR, kept))).toBe('no differences')
  })
})

describe('borderToCss', () => {
  it('maps the styles CSS has', () => {
    expect(borderToCss({ style: 'double', width: 1.5, color: '#000000' })).toBe(
      '1.5pt double #000000',
    )
    expect(borderToCss({ style: 'dashed', width: 0.5, color: null })).toContain('dashed')
  })

  it('falls back to solid for a style CSS lacks', () => {
    expect(borderToCss({ style: 'wave', width: 0.5, color: null })).toContain('solid')
  })

  it('gives a thick border a visible minimum width', () => {
    expect(borderToCss({ style: 'thick', width: 0.25, color: null })).toContain('1.5pt')
  })

  it('renders none as none', () => {
    expect(borderToCss({ style: 'none', width: 0, color: null })).toBe('none')
    expect(borderToCss(undefined)).toBe('none')
  })
})

/**
 * What a row states before its cells.
 *
 * `w:trPr` is the height and "repeat as header row". `w:tblPrEx` comes before
 * it — the table property exceptions a row carries when it disagrees with its
 * table about borders, margins or width — and was dropped, because the parser
 * kept `w:trPr` by name rather than keeping what it did not model.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/6
 */
describe('a row with table property exceptions', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const document = (row: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<w:document xmlns:w="${W}"><w:body><w:tbl>` +
    `<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="4675"/></w:tblGrid>${row}</w:tbl></w:body></w:document>`

  const row =
    '<w:tr>' +
    '<w:tblPrEx><w:tblBorders><w:top w:val="single" w:sz="4" w:color="FF0000"/></w:tblBorders></w:tblPrEx>' +
    '<w:trPr><w:trHeight w:val="454"/></w:trPr>' +
    '<w:tc><w:tcPr><w:tcW w:w="4675" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>One</w:t></w:r></w:p></w:tc>' +
    '</w:tr>'

  it('keeps the exceptions, and the row properties after them', () => {
    const rewritten = serializeParsed(parseDocument(document(row)))

    expect(rewritten).toContain('<w:tblPrEx>')
    expect(rewritten).toContain('w:color="FF0000"')
    expect(rewritten.indexOf('w:tblPrEx')).toBeLessThan(rewritten.indexOf('w:trPr'))
  })

  it('leaves the table with no differences at all', () => {
    const source = document(row)
    const rewritten = serializeParsed(parseDocument(source), source)

    expect(describeDifferences(compareXml(source, rewritten))).toBe('no differences')
  })

  it('carries only what stands before the first cell', () => {
    // A content control in a row wraps cells rather than preceding them, so
    // "everything that is not a cell" swept one to the front — which
    // `pnpm corpus:render` caught as half a percent of moved pixels in
    // `word2010win-footnotes-01.docx`.
    const withControl = document(
      '<w:tr><w:trPr><w:trHeight w:val="454"/></w:trPr>' +
        '<w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>First</w:t></w:r></w:p></w:tc>' +
        '<w:sdt><w:sdtContent><w:tc><w:tcPr><w:tcW w:w="2000" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>Second</w:t></w:r></w:p></w:tc></w:sdtContent></w:sdt>' +
        '</w:tr>',
    )
    const rewritten = serializeParsed(parseDocument(withControl), withControl)

    expect(rewritten).toContain('<w:trHeight w:val="454"/>')
    expect(rewritten.indexOf('w:trHeight')).toBeLessThan(rewritten.indexOf('First'))
    expect(rewritten.indexOf('First')).toBeLessThan(rewritten.indexOf('w:sdt'))
  })
})

/**
 * A table cell inside a content control.
 *
 * Word wraps a cell in `w:sdt` when it is bound to something: a repeating row,
 * a rich-text control, a field somebody fills in. The wrapper stands among the
 * cells rather than before them, and the parser's cell loop read `w:tc`
 * children and nothing else — so the cell was not in the editor, and not in
 * the file that was saved afterwards either.
 *
 * `word2010win-footnotes-01.docx` in the public corpus has one, holding the
 * text `Rich_text_in_cell`.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/28
 */
describe('a table cell inside a content control', () => {
  const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
  const control = (cells: string) =>
    `<w:sdt><w:sdtPr><w:id w:val="288325205"/><w:placeholder><w:docPart w:val="DefaultPlaceholder_1082065158"/></w:placeholder></w:sdtPr><w:sdtEndPr/><w:sdtContent>${cells}</w:sdtContent></w:sdt>`
  const cell = (text: string) =>
    `<w:tc><w:tcPr><w:tcW w:w="1915" w:type="dxa"/></w:tcPr><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:tc>`

  const document = (row: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\r\n` +
    `<w:document xmlns:w="${W}"><w:body><w:tbl>` +
    `<w:tblPr><w:tblW w:w="0" w:type="auto"/></w:tblPr>` +
    `<w:tblGrid><w:gridCol w:w="1915"/><w:gridCol w:w="1915"/></w:tblGrid>${row}</w:tbl></w:body></w:document>`

  const row = `<w:tr>${cell('Plain')}${control(cell('Bound'))}</w:tr>`

  it('reads the cell that is inside it', () => {
    const parsed = parseDocument(document(row))

    expect(JSON.stringify(parsed.doc)).toContain('Bound')
  })

  it('gives it to the editor as an ordinary cell, so it draws', () => {
    const table = (parseDocument(document(row)).doc.content ?? [])[0]
    const cells = (table?.content ?? [])[0]?.content ?? []

    expect(cells.length).toBe(2)
    expect(cells.every((one) => one.type === 'tableCell')).toBe(true)
  })

  it('writes it back inside its control, in the place it was', () => {
    const source = document(row)
    const rewritten = serializeParsed(parseDocument(source), source)

    expect(rewritten).toContain('<w:id w:val="288325205"/>')
    expect(rewritten.indexOf('Plain')).toBeLessThan(rewritten.indexOf('w:sdt'))
    expect(rewritten.indexOf('w:sdtContent')).toBeLessThan(rewritten.indexOf('Bound'))
  })

  it('leaves the table with no differences at all', () => {
    const source = document(row)
    const rewritten = serializeParsed(parseDocument(source), source)

    expect(describeDifferences(compareXml(source, rewritten))).toBe('no differences')
  })

  it('puts two cells of one control back into one control', () => {
    const source = document(`<w:tr>${control(cell('First') + cell('Second'))}</w:tr>`)
    const rewritten = serializeParsed(parseDocument(source), source)

    expect(rewritten.match(/<w:sdt>/gu)?.length).toBe(1)
    expect(describeDifferences(compareXml(source, rewritten))).toBe('no differences')
  })
})
