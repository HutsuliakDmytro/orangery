import { parseXml } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { describe, expect, it } from 'vitest'
import { readTable, visibleCells } from './table'
import { textOfBody } from './text-body'

function node(xml: string): XmlNode {
  const parsed = parseXml(xml)[0]
  if (parsed === undefined) throw new Error(`not parseable: ${xml}`)
  return parsed
}

const cell = (text: string, attributes = '') =>
  `<a:tc ${attributes}><a:txBody><a:p><a:r><a:t>${text}</a:t></a:r></a:p></a:txBody><a:tcPr/></a:tc>`

describe('readTable', () => {
  const table = readTable(
    node(
      '<a:tbl><a:tblPr firstRow="1" bandRow="1"><a:tableStyleId>{5C22544A}</a:tableStyleId></a:tblPr>' +
        '<a:tblGrid><a:gridCol w="2438400"/><a:gridCol w="1219200"/></a:tblGrid>' +
        `<a:tr h="609600">${cell('one')}${cell('two')}</a:tr>` +
        '</a:tbl>',
    ),
  )

  it('reads the grid, whose width is the number of columns', () => {
    expect(table.columns).toEqual([2438400, 1219200])
  })

  it('reads the flags that decide which style rules apply', () => {
    expect(table.properties).toMatchObject({ firstRow: true, bandedRows: true, lastRow: false })
    expect(table.properties.styleId).toBe('{5C22544A}')
  })

  it('reads each cell as a text body', () => {
    const cells = table.rows[0]?.cells ?? []
    expect(cells.map((one) => (one.text ? textOfBody(one.text) : null))).toEqual(['one', 'two'])
  })

  it('reads the stated row height', () => {
    expect(table.rows[0]?.height).toBe(609600)
  })
})

describe('merged cells', () => {
  // A merge does not remove cells. The top-left of the block carries the span,
  // and every cell it swallowed is still in the file, flagged.
  const table = readTable(
    node(
      '<a:tbl><a:tblGrid><a:gridCol w="100"/><a:gridCol w="100"/><a:gridCol w="100"/></a:tblGrid>' +
        `<a:tr>${cell('wide', 'gridSpan="2"')}${cell('', 'hMerge="1"')}${cell('right')}</a:tr>` +
        `<a:tr>${cell('tall', 'rowSpan="2"')}${cell('b')}${cell('c')}</a:tr>` +
        `<a:tr>${cell('', 'vMerge="1"')}${cell('e')}${cell('f')}</a:tr>` +
        '</a:tbl>',
    ),
  )

  it('keeps every cell, including the ones swallowed by a merge', () => {
    // Dropping them would misalign the grid and PowerPoint would refuse the file.
    expect(table.rows.map((row) => row.cells.length)).toEqual([3, 3, 3])
  })

  it('reads the span from the cell that owns the block', () => {
    expect(table.rows[0]?.cells[0]).toMatchObject({ gridSpan: 2, horizontallyMerged: false })
    expect(table.rows[1]?.cells[0]).toMatchObject({ rowSpan: 2, verticallyMerged: false })
  })

  it('flags the continuation cells rather than guessing from the spans', () => {
    expect(table.rows[0]?.cells[1]?.horizontallyMerged).toBe(true)
    expect(table.rows[2]?.cells[0]?.verticallyMerged).toBe(true)
  })

  it('draws only the origin of each block', () => {
    expect(visibleCells(table.rows[0] ?? { height: null, cells: [], node: {} })).toHaveLength(2)
    expect(visibleCells(table.rows[2] ?? { height: null, cells: [], node: {} })).toHaveLength(2)
  })

  it('defaults a span to one rather than zero', () => {
    expect(table.rows[0]?.cells[2]).toMatchObject({ gridSpan: 1, rowSpan: 1 })
  })
})

describe('cell properties', () => {
  it('reads padding, anchor, fill and borders', () => {
    const table = readTable(
      node(
        '<a:tbl><a:tr><a:tc><a:txBody><a:p/></a:txBody>' +
          '<a:tcPr marL="91440" anchor="ctr">' +
          '<a:lnL w="12700"><a:solidFill><a:srgbClr val="FF7A00"/></a:solidFill></a:lnL>' +
          '<a:solidFill><a:srgbClr val="161616"/></a:solidFill>' +
          '</a:tcPr></a:tc></a:tr></a:tbl>',
      ),
    )
    const properties = table.rows[0]?.cells[0]?.properties

    expect(properties).toMatchObject({ anchor: 'ctr' })
    expect(properties?.insets.left).toBe(91440)
    expect(properties?.fill).toMatchObject({ kind: 'solid' })
    expect(properties?.borders.left?.width).toBe(12700)
    expect(properties?.borders.right).toBeNull()
  })
})
