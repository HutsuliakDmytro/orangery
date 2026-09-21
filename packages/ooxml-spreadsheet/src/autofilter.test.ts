import { describe, expect, it } from 'vitest'
import { parseXml, tagName } from '@orangery/ooxml-core'
import type { FilterColumn, FilterCondition, FilterCriteria } from './autofilter'
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

    expect(filter?.columns).toEqual([
      { column: 1, criteria: { kind: 'values', values: ['Kyiv', 'Lviv'], blanks: false } },
    ])
  })

  it('reads keeping the blanks as its own answer', () => {
    // An empty cell is not the value "", which is something a cell can hold.
    const filter = read(
      '<autoFilter ref="A1:A9"><filterColumn colId="0"><filters blank="1">' +
        '<filter val="x"/></filters></filterColumn></autoFilter>',
    )

    expect(filter?.columns[0]?.criteria).toMatchObject({ blanks: true })
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

  const keeping = (values: string[], blanks = false): FilterCriteria => ({
    kind: 'values',
    values,
    blanks,
  })

  it('adds criteria where there were none', () => {
    const after = withFilter(filter, 1, keeping(['a']))
    expect(after.columns).toEqual([{ column: 1, criteria: keeping(['a']) }])
  })

  it('replaces the criteria a column already had', () => {
    const once = withFilter(filter, 1, keeping(['a']))
    const twice = withFilter(once, 1, keeping(['b'], true))

    expect(twice.columns).toEqual([{ column: 1, criteria: keeping(['b'], true) }])
  })

  it('takes a column’s criteria away, leaving the arrows', () => {
    const once = withFilter(filter, 1, keeping(['a']))
    const cleared = withFilter(once, 1, null)

    expect(cleared.columns).toEqual([])
    expect(cleared.range).toEqual(filter.range)
  })

  it('keeps the columns in order, so the file reads the same twice', () => {
    const after = withFilter(withFilter(filter, 2, keeping(['a'])), 0, keeping(['b']))

    expect(after.columns.map((one) => one.column)).toEqual([0, 2])
  })
})

describe('what gets through', () => {
  const criteria: FilterColumn = {
    column: 0,
    criteria: { kind: 'values', values: ['Kyiv'], blanks: false },
  }

  it('lets everything through where a column has no criteria', () => {
    expect(passes(undefined, 'anything')).toBe(true)
  })

  it('keeps the values named and nothing else', () => {
    expect(passes(criteria, 'Kyiv')).toBe(true)
    expect(passes(criteria, 'Lviv')).toBe(false)
  })

  it('answers about a blank with the blank rule rather than the list', () => {
    expect(passes(criteria, '')).toBe(false)
    expect(
      passes({ column: 0, criteria: { kind: 'values', values: ['Kyiv'], blanks: true } }, ''),
    ).toBe(true)
  })
})

describe('writing it back', () => {
  const filter = {
    range: { sheet: null, from: { row: 0, column: 0 }, to: { row: 8, column: 2 } },
    columns: [{ column: 1, criteria: { kind: 'values' as const, values: ['Kyiv'], blanks: true } }],
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
      columns: [
        { column: 0, criteria: { kind: 'values' as const, values: ['a & b'], blanks: false } },
      ],
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

describe('a column filtered by a condition rather than a list', () => {
  const condition = (
    conditions: { operator: FilterCondition['operator']; value: string }[],
    all = false,
  ): FilterColumn => ({ column: 0, criteria: { kind: 'conditions', all, conditions } })

  it('is read out of the element the file keeps it in', () => {
    const filter = read(
      '<autoFilter ref="A1:A9"><filterColumn colId="0"><customFilters and="1">' +
        '<customFilter operator="greaterThan" val="5"/>' +
        '<customFilter operator="lessThan" val="9"/>' +
        '</customFilters></filterColumn></autoFilter>',
    )

    expect(filter?.columns[0]?.criteria).toEqual({
      kind: 'conditions',
      all: true,
      conditions: [
        { operator: 'greaterThan', value: '5' },
        { operator: 'lessThan', value: '9' },
      ],
    })
  })

  it('compares numbers as numbers, so a hundred is more than nine', () => {
    // As text it would not be, and a number filter that dropped the largest
    // row is the kind of wrong that goes unnoticed.
    const more = condition([{ operator: 'greaterThan', value: '9' }])

    expect(passes(more, '100')).toBe(true)
    expect(passes(more, '8')).toBe(false)
  })

  it('compares words as words where they are words', () => {
    const after = condition([{ operator: 'greaterThan', value: 'm' }])

    expect(passes(after, 'north')).toBe(true)
    expect(passes(after, 'east')).toBe(false)
  })

  it('reads a star as anything at all, which is what "contains" is', () => {
    const holding = condition([{ operator: 'equal', value: '*ist*' }])

    expect(passes(holding, 'a distant thing')).toBe(true)
    expect(passes(holding, 'nothing here')).toBe(false)
  })

  it('reads a question mark as one letter', () => {
    const like = condition([{ operator: 'equal', value: 'Sm?th' }])

    expect(passes(like, 'Smith')).toBe(true)
    expect(passes(like, 'Smooth')).toBe(false)
  })

  it('reads a tilde as "the next one is a letter, not a wildcard"', () => {
    // A part number with a star in it has to be filterable too.
    const starred = condition([{ operator: 'equal', value: '*A~*B*' }])

    expect(passes(starred, 'part A*B here')).toBe(true)
    expect(passes(starred, 'part AZB here')).toBe(false)
  })

  it('ignores case, as a spreadsheet does everywhere else', () => {
    expect(passes(condition([{ operator: 'equal', value: 'north' }]), 'North')).toBe(true)
  })

  it('takes both conditions where the file says both', () => {
    const between = condition(
      [
        { operator: 'greaterThanOrEqual', value: '5' },
        { operator: 'lessThanOrEqual', value: '9' },
      ],
      true,
    )

    expect(passes(between, '7')).toBe(true)
    expect(passes(between, '11')).toBe(false)
  })

  it('takes either where it does not', () => {
    const outside = condition([
      { operator: 'lessThan', value: '5' },
      { operator: 'greaterThan', value: '9' },
    ])

    expect(passes(outside, '11')).toBe(true)
    expect(passes(outside, '7')).toBe(false)
  })

  it('goes back into the file as the element it came out of', () => {
    const written = writeAutoFilter({
      range: { sheet: null, from: { row: 0, column: 0 }, to: { row: 8, column: 0 } },
      columns: [
        condition(
          [
            { operator: 'greaterThanOrEqual', value: '5' },
            { operator: 'lessThanOrEqual', value: '9' },
          ],
          true,
        ),
      ],
    })

    expect(written).toContain('<customFilters and="1">')
    expect(written).toContain('<customFilter operator="greaterThanOrEqual" val="5"/>')
  })
})
