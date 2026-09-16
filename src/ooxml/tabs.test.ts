import { describe, expect, it } from 'vitest'
import { parseDocument } from './parse-document'
import { serializeDocument } from './serialize-document'
import {
  defaultStopAfter,
  nextStop,
  parseTabs,
  serializeTabs,
  withoutStop,
  withStop,
} from './tabs'
import type { TabStop } from './tabs'
import { parseXml } from './xml'

const tabsNode = (body: string) =>
  parseXml(
    `<w:tabs xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${body}</w:tabs>`,
  )[0]

const stop = (position: number, extra: Partial<TabStop> = {}): TabStop => ({
  position,
  alignment: 'left',
  leader: 'none',
  ...extra,
})

describe('parseTabs', () => {
  it('reads position, alignment and leader', () => {
    const stops = parseTabs(tabsNode('<w:tab w:val="right" w:leader="dot" w:pos="9360"/>'))

    expect(stops).toEqual([{ position: 468, alignment: 'right', leader: 'dot' }])
  })

  it('sorts them, since a tab lands at the next one to its right', () => {
    const stops = parseTabs(
      tabsNode('<w:tab w:val="left" w:pos="2880"/><w:tab w:val="left" w:pos="1440"/>'),
    )

    expect(stops.map((entry) => entry.position)).toEqual([72, 144])
  })

  it('leaves out a stop that cancels an inherited one', () => {
    // Written back as a real stop it would put a tab where the document says
    // there is none.
    expect(parseTabs(tabsNode('<w:tab w:val="clear" w:pos="1440"/>'))).toEqual([])
  })

  it('reads an alignment or leader it does not know as the plain one', () => {
    const stops = parseTabs(tabsNode('<w:tab w:val="num" w:leader="heavy" w:pos="1440"/>'))

    expect(stops[0]?.alignment).toBe('left')
    expect(stops[0]?.leader).toBe('none')
  })

  it('skips a stop with nowhere to be', () => {
    expect(parseTabs(tabsNode('<w:tab w:val="left"/>'))).toEqual([])
  })
})

describe('serializeTabs', () => {
  it('writes nothing for a paragraph with no stops of its own', () => {
    expect(serializeTabs([])).toBeNull()
  })

  it('leaves the leader out when there is none', () => {
    const xml = JSON.stringify(serializeTabs([stop(72)]))
    expect(xml).not.toContain('leader')
  })
})

describe('editing the stops', () => {
  it('replaces one already at that position', () => {
    const stops = withStop([stop(72, { leader: 'dot' })], stop(72, { alignment: 'right' }))

    expect(stops).toHaveLength(1)
    expect(stops[0]?.alignment).toBe('right')
  })

  it('keeps them sorted as one is added', () => {
    const stops = withStop([stop(144)], stop(72))
    expect(stops.map((entry) => entry.position)).toEqual([72, 144])
  })

  it('removes one by position', () => {
    expect(withoutStop([stop(72), stop(144)], 72).map((entry) => entry.position)).toEqual([144])
  })
})

describe('where a tab lands', () => {
  it('goes to the next stop to the right', () => {
    expect(nextStop([stop(72), stop(144)], 80)?.position).toBe(144)
  })

  it('has nowhere to go past the last one', () => {
    expect(nextStop([stop(72)], 100)).toBeNull()
  })

  it('falls back to the regular interval where a paragraph states none', () => {
    expect(defaultStopAfter(0)).toBe(36)
    expect(defaultStopAfter(36)).toBe(72)
    expect(defaultStopAfter(40)).toBe(72)
  })
})

describe('tab stops through a document', () => {
  const wrap = (body: string) =>
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`

  const paragraph = (pPr: string) => wrap(`<w:p><w:pPr>${pPr}</w:pPr><w:r><w:t>x</w:t></w:r></w:p>`)

  it('reaches the paragraph as an attribute', () => {
    const { doc } = parseDocument(
      paragraph('<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs>'),
    )

    expect(doc.content?.[0]?.attrs?.['tabs']).toEqual([
      { position: 468, alignment: 'right', leader: 'dot' },
    ])
  })

  it('writes an untouched paragraph back as it was', () => {
    const source = paragraph('<w:tabs><w:tab w:val="right" w:leader="dot" w:pos="9360"/></w:tabs>')

    const xml = serializeDocument(parseDocument(source).doc, {
      documentAttributes: {},
      sectionProperties: null,
      alwaysPreserveSpace: false,
    })

    expect(xml).toContain('<w:tab w:val="right" w:leader="dot" w:pos="9360"/>')
  })

  it('rebuilds the stops when the paragraph changed', () => {
    const parsed = parseDocument(paragraph('<w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs>'))
    const block = parsed.doc.content?.[0]
    if (block?.attrs) block.attrs['tabs'] = [{ position: 216, alignment: 'right', leader: 'dot' }]

    const xml = serializeDocument(parsed.doc, {
      documentAttributes: {},
      sectionProperties: null,
      alwaysPreserveSpace: false,
    })

    expect(xml).toContain('<w:tab w:val="right" w:leader="dot" w:pos="4320"/>')
    expect(xml).not.toContain('w:pos="1440"')
  })

  it('keeps the order the schema requires when it rebuilds', () => {
    const parsed = parseDocument(
      paragraph('<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr><w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs>'),
    )
    const block = parsed.doc.content?.[0]
    if (block?.attrs) block.attrs['spaceAfter'] = 6

    const xml = serializeDocument(parsed.doc, {
      documentAttributes: {},
      sectionProperties: null,
      alwaysPreserveSpace: false,
    })

    const order = ['w:numPr', 'w:tabs', 'w:spacing'].map((tag) => xml.indexOf(tag))
    expect(order).toEqual([...order].sort((a, b) => a - b))
  })
})
