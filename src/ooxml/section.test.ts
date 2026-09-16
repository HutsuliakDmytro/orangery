import { describe, expect, it } from 'vitest'
import { compareXml, describeDifferences } from './compare'
import {
  contentHeight,
  contentWidth,
  DEFAULT_MARGINS,
  pageSizeIdFor,
  parseSection,
  serializeSection,
  withOrientation,
  withPageSize,
} from './section'

const LETTER =
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'

describe('parseSection', () => {
  it('reads page size in points', () => {
    const section = parseSection(LETTER)
    expect(section.width).toBe(612)
    expect(section.height).toBe(792)
  })

  it('reads margins in points', () => {
    expect(parseSection(LETTER).margins.top).toBe(72)
  })

  it('treats a missing orientation as portrait, as Word does', () => {
    expect(parseSection(LETTER).orientation).toBe('portrait')
  })

  it('reads an explicit landscape orientation', () => {
    const xml = '<w:sectPr><w:pgSz w:w="15840" w:h="12240" w:orient="landscape"/></w:sectPr>'
    expect(parseSection(xml).orientation).toBe('landscape')
  })

  it('falls back to defaults for margins the file omits', () => {
    const xml = '<w:sectPr><w:pgMar w:top="720"/></w:sectPr>'
    const margins = parseSection(xml).margins
    expect(margins.top).toBe(36)
    expect(margins.left).toBe(DEFAULT_MARGINS.left)
  })

  it('preserves children it does not model', () => {
    const xml = `<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:headerReference r:id="rId5"/><w:cols w:num="2"/></w:sectPr>`
    const section = parseSection(xml)
    expect(section.preserved.join('')).toContain('w:headerReference')
    expect(section.preserved.join('')).toContain('w:cols')
  })

  it('returns defaults for a missing or malformed section', () => {
    expect(parseSection(null).width).toBe(612)
    expect(parseSection('<nonsense/>').width).toBe(612)
  })
})

describe('serializeSection', () => {
  it('round-trips a section unchanged', () => {
    const rewritten = serializeSection(parseSection(LETTER))
    expect(describeDifferences(compareXml(LETTER, rewritten))).toBe('no differences')
  })

  it('writes preserved children back', () => {
    const xml =
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/><w:cols w:num="2"/></w:sectPr>'
    expect(serializeSection(parseSection(xml))).toContain('w:cols')
  })

  it('omits the orientation attribute for portrait, as Word does', () => {
    expect(serializeSection(parseSection(LETTER))).not.toContain('w:orient')
  })

  it('writes the orientation attribute for landscape', () => {
    const landscape = withOrientation(parseSection(LETTER), 'landscape')
    expect(serializeSection(landscape)).toContain('w:orient="landscape"')
  })
})

describe('withOrientation', () => {
  it('swaps width and height', () => {
    const landscape = withOrientation(parseSection(LETTER), 'landscape')
    expect(landscape.width).toBe(792)
    expect(landscape.height).toBe(612)
  })

  it('is a no-op when the orientation already matches', () => {
    const section = parseSection(LETTER)
    expect(withOrientation(section, 'portrait')).toBe(section)
  })

  it('round-trips back to the original size', () => {
    const section = parseSection(LETTER)
    const there = withOrientation(section, 'landscape')
    const back = withOrientation(there, 'portrait')
    expect(back.width).toBe(section.width)
    expect(back.height).toBe(section.height)
  })
})

describe('withPageSize', () => {
  it('applies a named size', () => {
    const a4 = withPageSize(parseSection(LETTER), 'a4')
    expect(a4.width).toBeCloseTo(595.28, 2)
  })

  it('keeps landscape when changing size', () => {
    const landscape = withOrientation(parseSection(LETTER), 'landscape')
    const a4 = withPageSize(landscape, 'a4')
    expect(a4.width).toBeGreaterThan(a4.height)
  })

  it('leaves the section alone for an unknown size', () => {
    const section = parseSection(LETTER)
    // @ts-expect-error deliberately passing an id that does not exist
    expect(withPageSize(section, 'nope')).toBe(section)
  })
})

describe('pageSizeIdFor', () => {
  it('recognises Letter and A4', () => {
    expect(pageSizeIdFor(612, 792)).toBe('letter')
    expect(pageSizeIdFor(595.28, 841.89)).toBe('a4')
  })

  it('recognises a rotated sheet as the same size', () => {
    expect(pageSizeIdFor(792, 612)).toBe('letter')
  })

  it('tolerates rounding through twips', () => {
    expect(pageSizeIdFor(595.25, 841.9)).toBe('a4')
  })

  it('returns null for a custom size', () => {
    expect(pageSizeIdFor(500, 500)).toBeNull()
  })
})

describe('content area', () => {
  it('subtracts side margins from the width', () => {
    expect(contentWidth(parseSection(LETTER))).toBe(468)
  })

  it('subtracts the gutter as well', () => {
    const xml =
      '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:left="1440" w:right="1440" w:gutter="720"/></w:sectPr>'
    expect(contentWidth(parseSection(xml))).toBe(432)
  })

  it('subtracts top and bottom margins from the height', () => {
    expect(contentHeight(parseSection(LETTER))).toBe(648)
  })
})

describe('page numbering', () => {
  const sectPr = (body: string) =>
    `<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:sectPr>`

  it('says nothing when the file says nothing', () => {
    // Absent means decimal and carrying on from the section before, which is
    // not the same as a file that states either.
    expect(parseSection(sectPr('<w:pgSz w:w="12240" w:h="15840"/>')).pageNumbering).toBeNull()
  })

  it('reads the format and the number to start at', () => {
    const section = parseSection(sectPr('<w:pgNumType w:start="3" w:fmt="lowerRoman"/>'))

    expect(section.pageNumbering?.format).toBe('lowerRoman')
    expect(section.pageNumbering?.start).toBe(3)
  })

  it('reads a format it does not know as plain numbers', () => {
    expect(parseSection(sectPr('<w:pgNumType w:fmt="chicago"/>')).pageNumbering?.format).toBe(
      'decimal',
    )
  })

  it('leaves the start empty when the section carries on', () => {
    expect(parseSection(sectPr('<w:pgNumType w:fmt="decimal"/>')).pageNumbering?.start).toBeNull()
  })

  it('reads a first page of its own', () => {
    expect(parseSection(sectPr('<w:titlePg/>')).differentFirstPage).toBe(true)
    expect(parseSection(sectPr('<w:titlePg w:val="0"/>')).differentFirstPage).toBe(false)
  })

  it('round-trips both', () => {
    const source = sectPr(
      '<w:pgSz w:w="12240" w:h="15840"/><w:pgNumType w:start="5" w:fmt="upperRoman"/><w:titlePg/>',
    )
    const again = parseSection(serializeSection(parseSection(source)))

    expect(again.pageNumbering).toEqual({ format: 'upperRoman', start: 5 })
    expect(again.differentFirstPage).toBe(true)
  })

  it('writes nothing for a document that has neither', () => {
    const xml = serializeSection(parseSection(sectPr('<w:pgSz w:w="12240" w:h="15840"/>')))

    expect(xml).not.toContain('w:pgNumType')
    expect(xml).not.toContain('w:titlePg')
  })
})

describe('the order of the section properties', () => {
  const sectPr = (body: string) =>
    `<w:sectPr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:sectPr>`

  it('puts the header reference first, wherever it was read from', () => {
    // Appended after the page size it would be out of order, and Word offers to
    // repair a section whose properties are not in the sequence the schema sets.
    const xml = serializeSection(
      parseSection(
        sectPr('<w:pgSz w:w="12240" w:h="15840"/><w:headerReference w:type="default" r:id="rId4"/>'),
      ),
    )

    expect(xml.indexOf('w:headerReference')).toBeLessThan(xml.indexOf('w:pgSz'))
  })

  it('puts the ones it writes where the schema wants them', () => {
    const xml = serializeSection(
      parseSection(sectPr('<w:titlePg/><w:pgNumType w:fmt="decimal"/><w:cols w:num="2"/>')),
    )

    const order = ['w:pgMar', 'w:pgNumType', 'w:cols', 'w:titlePg'].map((tag) => xml.indexOf(tag))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })

  it('keeps two unknown children in the order they arrived', () => {
    const xml = serializeSection(
      parseSection(sectPr('<w:unknownOne w:val="1"/><w:unknownTwo w:val="2"/>')),
    )

    expect(xml.indexOf('w:unknownOne')).toBeLessThan(xml.indexOf('w:unknownTwo'))
  })
})
