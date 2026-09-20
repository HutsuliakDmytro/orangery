import { describe, expect, it } from 'vitest'
import { parseRelationships, serializeRelationships } from '@orangery/ooxml-core'
import type { Relationship } from '@orangery/ooxml-core'
import {
  linkCovering,
  readHyperlinks,
  replaceHyperlinks,
  withLink,
  withoutLinks,
  writeHyperlinks,
} from './hyperlinks'
import type { Hyperlink } from './hyperlinks'

/**
 * The cells that are also a way somewhere else.
 *
 * Where a link points is kept in two different places depending on where it
 * goes: outside the workbook it is a relationship, inside it is an attribute.
 * Everything here is about not confusing the two.
 */

const sheet = (inside: string) =>
  '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
  `<sheetData/>${inside}</worksheet>`

const rels = (xml = ''): Map<string, Relationship> =>
  parseRelationships(
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      `${xml}</Relationships>`,
  )

const outward = rels(
  '<Relationship Id="rId1" Target="https://example.org/" TargetMode="External" ' +
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"/>',
)

const range = (from: { row: number; column: number }, to = from) => ({ sheet: null, from, to })

describe('reading them', () => {
  it('follows a relationship out of the package', () => {
    const links = readHyperlinks(
      sheet('<hyperlinks><hyperlink ref="A1" r:id="rId1"/></hyperlinks>'),
      outward,
    )

    expect(links[0]?.target).toBe('https://example.org/')
    expect(links[0]?.range.from).toEqual({ row: 0, column: 0 })
  })

  it('reads a link inside the workbook off the element itself', () => {
    const links = readHyperlinks(
      sheet('<hyperlinks><hyperlink ref="B2" location="Notes!A1"/></hyperlinks>'),
      rels(),
    )

    expect(links[0]?.location).toBe('Notes!A1')
    expect(links[0]?.target).toBeNull()
  })

  it('keeps the tooltip, which is the only thing a link can say for itself', () => {
    const links = readHyperlinks(
      sheet('<hyperlinks><hyperlink ref="A1" tooltip="The site"/></hyperlinks>'),
      rels(),
    )

    expect(links[0]?.tooltip).toBe('The site')
  })

  it('reads a link over a range as the range it is', () => {
    const links = readHyperlinks(
      sheet('<hyperlinks><hyperlink ref="A1:B3" location="x"/></hyperlinks>'),
      rels(),
    )

    expect(links[0]?.range.to).toEqual({ row: 2, column: 1 })
  })

  it('finds none in a sheet that has none', () => {
    expect(readHyperlinks(sheet(''), rels())).toEqual([])
  })
})

describe('the link a cell belongs to', () => {
  const links: Hyperlink[] = [
    {
      range: range({ row: 0, column: 0 }, { row: 1, column: 1 }),
      target: 'https://example.org/',
      location: null,
      tooltip: null,
      relationshipId: null,
    },
  ]

  it('covers every cell of its range, not only the corner', () => {
    expect(linkCovering(links, { row: 1, column: 1 })).toBe(links[0])
  })

  it('is nothing for a cell outside it', () => {
    expect(linkCovering(links, { row: 5, column: 5 })).toBeNull()
  })
})

describe('changing the list', () => {
  const one: Hyperlink = {
    range: range({ row: 0, column: 0 }),
    target: 'https://example.org/',
    location: null,
    tooltip: null,
    relationshipId: null,
  }

  it('takes out what a new link lands on', () => {
    // Excel writes the first of two links on a cell and ignores the rest.
    const after = withLink([one], { ...one, target: 'https://elsewhere.org/' })

    expect(after).toHaveLength(1)
    expect(after[0]?.target).toBe('https://elsewhere.org/')
  })

  it('leaves a link on another cell alone', () => {
    const elsewhere = { ...one, range: range({ row: 5, column: 5 }) }
    expect(withLink([one], elsewhere)).toHaveLength(2)
  })

  it('removes the links a range covers', () => {
    expect(withoutLinks([one], range({ row: 0, column: 0 }))).toEqual([])
  })
})

describe('writing them back', () => {
  it('puts an outside address in a relationship and points at it', () => {
    const relationships = rels()
    const written = writeHyperlinks(
      [
        {
          range: range({ row: 0, column: 0 }),
          target: 'https://example.org/',
          location: null,
          tooltip: null,
          relationshipId: null,
        },
      ],
      relationships,
    )

    expect(written).toContain('r:id="rId1"')
    expect(serializeRelationships(relationships)).toContain('TargetMode="External"')
  })

  it('keeps the id a link came in on, so a saved file reads the same', () => {
    const relationships = new Map(outward)
    const written = writeHyperlinks(
      [
        {
          range: range({ row: 0, column: 0 }),
          target: 'https://example.org/',
          location: null,
          tooltip: null,
          relationshipId: 'rId1',
        },
      ],
      relationships,
    )

    expect(written).toContain('r:id="rId1"')
    expect(relationships.size).toBe(1)
  })

  it('writes a link inside the workbook without a relationship at all', () => {
    const relationships = rels()
    const written = writeHyperlinks(
      [
        {
          range: range({ row: 0, column: 0 }),
          target: null,
          location: 'Notes!A1',
          tooltip: null,
          relationshipId: null,
        },
      ],
      relationships,
    )

    expect(written).toContain('location="Notes!A1"')
    expect(written).not.toContain('r:id')
    expect(relationships.size).toBe(0)
  })

  it('writes nothing for no links, which is what takes the element away', () => {
    expect(writeHyperlinks([], rels())).toBe('')
  })

  it('goes back into the part before the print settings', () => {
    // Where the schema puts it; an element out of order is a file Excel
    // offers to repair.
    const part = sheet('<pageMargins left="0.7"/>')
    const after = replaceHyperlinks(part, '<hyperlinks><hyperlink ref="A1"/></hyperlinks>')

    expect(after.indexOf('<hyperlinks>')).toBeLessThan(after.indexOf('<pageMargins'))
  })

  it('goes after the cells in a part that has nothing else', () => {
    const after = replaceHyperlinks(sheet(''), '<hyperlinks><hyperlink ref="A1"/></hyperlinks>')
    expect(after.indexOf('<hyperlinks>')).toBeGreaterThan(after.indexOf('<sheetData/>'))
  })

  it('replaces the element that was there', () => {
    const part = sheet('<hyperlinks><hyperlink ref="A1" location="old"/></hyperlinks>')
    const after = replaceHyperlinks(
      part,
      '<hyperlinks><hyperlink ref="B2" location="new"/></hyperlinks>',
    )

    expect(after).toContain('location="new"')
    expect(after).not.toContain('location="old"')
  })

  it('takes the element away when the last link goes', () => {
    const part = sheet('<hyperlinks><hyperlink ref="A1" location="x"/></hyperlinks>')
    expect(replaceHyperlinks(part, '')).not.toContain('hyperlink')
  })
})

describe('a link that goes round the whole way', () => {
  it('comes back saying the same thing', () => {
    const relationships = rels()
    const links: Hyperlink[] = [
      {
        range: range({ row: 2, column: 1 }),
        target: 'https://example.org/page?a=1&b=2',
        location: null,
        tooltip: 'Both of them',
        relationshipId: null,
      },
    ]

    const part = replaceHyperlinks(sheet(''), writeHyperlinks(links, relationships))
    const again = readHyperlinks(part, relationships)

    expect(again[0]?.target).toBe('https://example.org/page?a=1&b=2')
    expect(again[0]?.tooltip).toBe('Both of them')
    expect(again[0]?.range.from).toEqual({ row: 2, column: 1 })
  })
})
