import { describe, expect, it } from 'vitest'
import { parseXml, tagName } from '@orangery/ooxml-core'
import {
  passes,
  readAutoFilter,
  replaceAutoFilter,
  withFilter,
  writeAutoFilter,
} from './autofilter'

/**
 * The arrows on a header row, and what they are hiding.
 *
 * Two things under one name: the range, which is what puts the arrows there,
 * and the criteria, which say what survives. A sheet can have the first
 * without the second, and that is the ordinary state of a table somebody has
 * turned filtering on for.
 */

const read = (xml: string) =>
  readAutoFilter(parseXml(xml).find((node) => tagName(node) === 'autoFilter'))

describe('reading one', () => {
  it('takes the range the arrows sit on', () => {
    expect(read('<autoFilter ref="A1:C9"/>')?.range.to).toEqual({ row: 8, column: 2 })
  })

  it('takes the values a column keeps', () => {
    const filter = read(
      '<autoFilter ref="A1:C9"><filterColumn colId="1"><filters>' +
        '<filter val="Kyiv"/><filter val="Lviv"/></filters></filterColumn></autoFilter>',
    )

    expect(filter?.columns).toEqual([{ column: 1, values: ['Kyiv', 'Lviv'], blanks: false }])
  })

  it('reads keeping the blanks as its own answer', () => {
    // An empty cell is not the value "", which is something a cell can hold.
    const filter = read(
      '<autoFilter ref="A1:A9"><filterColumn colId="0"><filters blank="1">' +
        '<filter val="x"/></filters></filterColumn></autoFilter>',
    )

    expect(filter?.columns[0]?.blanks).toBe(true)
  })

  it('is nothing where the sheet has none', () => {
    expect(readAutoFilter(undefined)).toBeNull()
  })
})

describe('changing what a column keeps', () => {
  const filter = {
    range: { sheet: null, from: { row: 0, column: 0 }, to: { row: 9, column: 2 } },
    columns: [],
  }

  it('adds criteria where there were none', () => {
    const after = withFilter(filter, 1, { values: ['a'], blanks: false })
    expect(after.columns).toEqual([{ column: 1, values: ['a'], blanks: false }])
  })

  it('replaces the criteria a column already had', () => {
    const once = withFilter(filter, 1, { values: ['a'], blanks: false })
    const twice = withFilter(once, 1, { values: ['b'], blanks: true })

    expect(twice.columns).toEqual([{ column: 1, values: ['b'], blanks: true }])
  })

  it('takes a column’s criteria away, leaving the arrows', () => {
    const once = withFilter(filter, 1, { values: ['a'], blanks: false })
    const cleared = withFilter(once, 1, null)

    expect(cleared.columns).toEqual([])
    expect(cleared.range).toEqual(filter.range)
  })

  it('keeps the columns in order, so the file reads the same twice', () => {
    const after = withFilter(withFilter(filter, 2, { values: ['a'], blanks: false }), 0, {
      values: ['b'],
      blanks: false,
    })

    expect(after.columns.map((one) => one.column)).toEqual([0, 2])
  })
})

describe('what gets through', () => {
  const criteria = { column: 0, values: ['Kyiv'], blanks: false }

  it('lets everything through where a column has no criteria', () => {
    expect(passes(undefined, 'anything')).toBe(true)
  })

  it('keeps the values named and nothing else', () => {
    expect(passes(criteria, 'Kyiv')).toBe(true)
    expect(passes(criteria, 'Lviv')).toBe(false)
  })

  it('answers about a blank with the blank rule rather than the list', () => {
    expect(passes(criteria, '')).toBe(false)
    expect(passes({ ...criteria, blanks: true }, '')).toBe(true)
  })
})

describe('writing it back', () => {
  const filter = {
    range: { sheet: null, from: { row: 0, column: 0 }, to: { row: 8, column: 2 } },
    columns: [{ column: 1, values: ['Kyiv'], blanks: true }],
  }

  it('names the range and the criteria', () => {
    expect(writeAutoFilter(filter)).toBe(
      '<autoFilter ref="A1:C9"><filterColumn colId="1"><filters blank="1">' +
        '<filter val="Kyiv"/></filters></filterColumn></autoFilter>',
    )
  })

  it('writes arrows with nothing filtered as an empty element', () => {
    expect(writeAutoFilter({ ...filter, columns: [] })).toBe('<autoFilter ref="A1:C9"/>')
  })

  it('escapes a value that would otherwise be markup', () => {
    const written = writeAutoFilter({
      ...filter,
      columns: [{ column: 0, values: ['a & b'], blanks: false }],
    })

    expect(written).toContain('val="a &amp; b"')
  })

  it('replaces the element that was there', () => {
    const sheet = '<worksheet xmlns="x"><sheetData/><autoFilter ref="A1:A2"/></worksheet>'
    const after = replaceAutoFilter(sheet, filter)

    expect(after).toContain('ref="A1:C9"')
    expect(after).not.toContain('ref="A1:A2"')
  })

  it('puts a new one after the merges, where the schema wants it', () => {
    const sheet =
      '<worksheet xmlns="x"><sheetData/><mergeCells count="1">' +
      '<mergeCell ref="A1:B1"/></mergeCells></worksheet>'
    const after = replaceAutoFilter(sheet, filter)

    expect(after.indexOf('<autoFilter')).toBeGreaterThan(after.indexOf('</mergeCells>'))
  })

  it('takes the element away when the filter goes', () => {
    const sheet = '<worksheet xmlns="x"><sheetData/><autoFilter ref="A1:A2"/></worksheet>'
    expect(replaceAutoFilter(sheet, null)).not.toContain('autoFilter')
  })
})
