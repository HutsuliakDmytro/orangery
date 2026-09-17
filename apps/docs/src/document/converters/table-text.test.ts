import { describe, expect, it } from 'vitest'
import type { ProseMirrorNodeJson } from '../../ooxml/prosemirror-json'
import {
  escapeTableCell,
  flattenTable,
  parseMarkdownTable,
  tableFromRows,
  toMarkdownTable,
} from './table-text'
import { textContentOf } from './types'

const inline = (node: ProseMirrorNodeJson) => textContentOf(node)

const cell = (text: string, attrs: Record<string, number> = {}) => ({
  type: 'tableCell',
  attrs: { colspan: 1, rowspan: 1, ...attrs },
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
})

const table = (rows: ReturnType<typeof cell>[][]): ProseMirrorNodeJson => ({
  type: 'table',
  content: rows.map((row) => ({ type: 'tableRow', content: row })),
})

describe('flattenTable', () => {
  it('reads a plain grid', () => {
    const flat = flattenTable(
      table([
        [cell('A'), cell('B')],
        [cell('1'), cell('2')],
      ]),
      inline,
    )
    expect(flat.rows).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ])
  })

  it('repeats a cell across the columns it spans', () => {
    // An empty cell would read as missing data; the repeated value is at least
    // true, and neither Markdown nor a plain HTML table can say "merged".
    const flat = flattenTable(table([[cell('wide', { colspan: 2 }), cell('C')]]), inline)
    expect(flat.rows[0]).toEqual(['wide', 'wide', 'C'])
  })

  it('repeats a cell down the rows it spans', () => {
    const flat = flattenTable(
      table([[cell('tall', { rowspan: 2 }), cell('B')], [cell('E')]]),
      inline,
    )
    expect(flat.rows).toEqual([
      ['tall', 'B'],
      ['tall', 'E'],
    ])
  })

  it('reports that spans were lost', () => {
    expect(flattenTable(table([[cell('a')]]), inline).lostSpans).toBe(false)
    expect(flattenTable(table([[cell('a', { colspan: 2 })]]), inline).lostSpans).toBe(true)
  })

  it('pads ragged rows so columns line up', () => {
    const flat = flattenTable(table([[cell('A'), cell('B')], [cell('1')]]), inline)
    expect(flat.rows[1]).toEqual(['1', ''])
  })

  it('handles an empty table', () => {
    expect(flattenTable({ type: 'table' }, inline).rows).toEqual([])
  })
})

describe('toMarkdownTable', () => {
  const rendered = toMarkdownTable(
    flattenTable(
      table([
        [cell('A'), cell('B')],
        [cell('1'), cell('2')],
      ]),
      inline,
    ),
  )

  it('writes a header row and a divider', () => {
    const lines = rendered.split('\n')
    expect(lines[0]).toBe('| A | B |')
    expect(lines[1]).toBe('| --- | --- |')
  })

  it('writes one line per body row', () => {
    expect(rendered.split('\n')[2]).toBe('| 1 | 2 |')
  })

  it('returns nothing for an empty table', () => {
    expect(toMarkdownTable({ rows: [], lostSpans: false })).toBe('')
  })
})

describe('escapeTableCell', () => {
  it('escapes a pipe, which would end the cell early', () => {
    expect(escapeTableCell('a|b')).toBe('a\\|b')
  })

  it('flattens newlines, which a Markdown cell cannot hold', () => {
    expect(escapeTableCell('a\nb')).toBe('a b')
  })
})

describe('parseMarkdownTable', () => {
  it('reads a table', () => {
    expect(parseMarkdownTable(['| A | B |', '| --- | --- |', '| 1 | 2 |'])).toEqual([
      ['A', 'B'],
      ['1', '2'],
    ])
  })

  it('accepts alignment markers in the divider', () => {
    expect(parseMarkdownTable(['| A |', '| :--- |'])).toEqual([['A']])
    expect(parseMarkdownTable(['| A |', '| ---: |'])).toEqual([['A']])
  })

  it('refuses lines that merely contain pipes', () => {
    // A paragraph about "a | b" is not a table.
    expect(parseMarkdownTable(['| not a table |', '| still not |'])).toBeNull()
  })

  it('refuses a divider with the wrong number of columns', () => {
    expect(parseMarkdownTable(['| A | B |', '| --- |'])).toBeNull()
  })

  it('unescapes a pipe inside a cell', () => {
    expect(parseMarkdownTable(['| a\\|b |', '| --- |'])).toEqual([['a|b']])
  })

  it('needs at least a header and a divider', () => {
    expect(parseMarkdownTable(['| A |'])).toBeNull()
  })
})

describe('tableFromRows', () => {
  it('builds cells that hold a paragraph each', () => {
    const node = tableFromRows([['A', 'B']])
    expect(node.content?.[0]?.content?.[0]?.content?.[0]?.type).toBe('paragraph')
  })

  it('gives an empty cell an empty paragraph rather than no content', () => {
    const node = tableFromRows([['']])
    expect(node.content?.[0]?.content?.[0]?.content?.[0]?.content).toBeUndefined()
  })

  it('round-trips through the flattener', () => {
    const rows = [
      ['A', 'B'],
      ['1', '2'],
    ]
    expect(flattenTable(tableFromRows(rows), inline).rows).toEqual(rows)
  })
})
