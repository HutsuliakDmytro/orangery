import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { singleCell } from '@orangery/grid'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { applyEdit } from './edit'
import {
  applyFilter,
  conditionFor,
  conditionShown,
  filterColumn,
  toggleFilter,
  valuesIn,
} from './filter'
import { emptyHistory, recorded, undo } from './history'

/**
 * Filtering a table.
 *
 * Two halves that meet nowhere in the file: the criteria, which say which rows
 * should survive, and the hiding, which is written on the rows. Both are kept
 * because Excel keeps both — the criteria are the reason and the rows are the
 * result, and a reader with only one of them could not tell you what the
 * other should be.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let open: OpenWorkbook
let sheet: OpenSheet

beforeEach(async () => {
  open = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
  const first = open.sheets[0]
  if (first === undefined) throw new Error('the fixture has no sheets')
  sheet = first
})

const hidden = (row: number) => sheet.cells.properties.get(row)?.hidden ?? false

describe('turning the arrows on', () => {
  it('covers the table the cursor is in', () => {
    toggleFilter(open, sheet, { row: 1, column: 0 })

    expect(sheet.sheet.autoFilter?.range.from).toEqual({ row: 0, column: 0 })
    expect(sheet.sheet.autoFilter?.range.to).toEqual({ row: 3, column: 2 })
  })

  it('filters nothing to begin with', () => {
    toggleFilter(open, sheet, { row: 1, column: 0 })
    expect(sheet.sheet.autoFilter?.columns).toEqual([])
  })

  it('turns them off again', () => {
    toggleFilter(open, sheet, { row: 1, column: 0 })
    toggleFilter(open, sheet, { row: 1, column: 0 })

    expect(sheet.sheet.autoFilter).toBeNull()
  })

  it('refuses a cell with no table around it', () => {
    // Arrows on a single cell would filter its own header.
    expect(toggleFilter(open, sheet, { row: 30, column: 30 })).toEqual([])
  })
})

describe('what a column offers', () => {
  it('is every value it holds, without the header', () => {
    // The name of a column is not one of its values, and offering it as one
    // is how a filter ends up hiding the header.
    toggleFilter(open, sheet, { row: 1, column: 0 })
    const filter = sheet.sheet.autoFilter
    if (filter === null) throw new Error('the filter went missing')

    const choices = valuesIn(open, sheet, filter, 0)

    expect(choices.values).toContain('January')
    expect(choices.values).not.toContain('Month')
  })

  it('says separately whether the column has empty cells', () => {
    // An empty cell is not the value "", which a cell can hold; a list that
    // lumped them together would hide rows somebody left empty on purpose.
    applyEdit(open, sheet, { row: 2, column: 2 }, '')

    toggleFilter(open, sheet, { row: 1, column: 0 })
    const filter = sheet.sheet.autoFilter
    if (filter === null) throw new Error('the filter went missing')

    const choices = valuesIn(open, sheet, filter, 2)
    expect(choices.blanks).toBe(true)
    expect(choices.values).not.toContain('')
  })
})

describe('filtering', () => {
  const filtered = (values: string[]) => {
    toggleFilter(open, sheet, { row: 1, column: 0 })
    return filterColumn(open, sheet, 0, { kind: 'values', values, blanks: false })
  }

  it('hides the rows that do not match, and leaves the ones that do', () => {
    filtered(['January'])

    expect(hidden(1)).toBe(false)
    expect(hidden(2)).toBe(true)
  })

  it('never hides the header, which is where the arrows are', () => {
    // A filter that hid its own controls would be one nobody could turn off.
    filtered(['nothing at all'])
    expect(hidden(0)).toBe(false)
  })

  it('brings the rows back when the criteria are cleared', () => {
    filtered(['January'])
    filterColumn(open, sheet, 0, null)

    expect(hidden(2)).toBe(false)
    expect(sheet.sheet.autoFilter?.columns).toEqual([])
  })

  it('keeps the reason as well as the result', () => {
    filtered(['January'])

    expect(sheet.sheet.autoFilter?.columns[0]?.criteria).toMatchObject({ values: ['January'] })
    expect(hidden(2)).toBe(true)
  })
})

describe('taking a filter back', () => {
  it('puts the criteria and the rows back together', () => {
    toggleFilter(open, sheet, { row: 1, column: 0 })

    const history = recorded(emptyHistory(), {
      changes: filterColumn(open, sheet, 0, {
        kind: 'values',
        values: ['January'],
        blanks: false,
      }),
      selection: singleCell({ row: 0, column: 0 }),
    })
    expect(hidden(2)).toBe(true)

    undo(open, history)

    expect(hidden(2)).toBe(false)
    expect(sheet.sheet.autoFilter?.columns).toEqual([])
  })

  it('takes the arrows away again', () => {
    const history = recorded(emptyHistory(), {
      changes: toggleFilter(open, sheet, { row: 1, column: 0 }),
      selection: singleCell({ row: 0, column: 0 }),
    })

    undo(open, history)
    expect(sheet.sheet.autoFilter).toBeNull()
  })
})

describe('a filter that was already in the file', () => {
  it('is applied as it stands rather than recomputed', () => {
    // The criteria are the reason and the rows are the result; recomputing
    // would disagree with Excel about any row somebody hid by hand.
    applyFilter(open, sheet, {
      range: { sheet: null, from: { row: 0, column: 0 }, to: { row: 3, column: 2 } },
      columns: [{ column: 0, criteria: { kind: 'values', values: ['February'], blanks: false } }],
    })

    expect(hidden(1)).toBe(true)
    expect(hidden(2)).toBe(false)
  })
})

describe('filtering by a condition rather than by a list', () => {
  it('hides the rows the condition turns away', () => {
    toggleFilter(open, sheet, { row: 1, column: 0 })
    filterColumn(open, sheet, 0, {
      kind: 'conditions',
      all: false,
      conditions: [conditionFor('beginsWith', 'Feb')],
    })

    // January goes, February stays.
    expect(hidden(1)).toBe(true)
    expect(hidden(2)).toBe(false)
  })

  it('says "contains" the way the file says it', () => {
    expect(conditionFor('contains', 'ary')).toEqual({ operator: 'equal', value: '*ary*' })
  })

  it('reads the file’s spelling back as the words somebody used', () => {
    expect(conditionShown({ operator: 'equal', value: '*ary*' })).toEqual({
      kind: 'contains',
      text: 'ary',
    })
    expect(conditionShown({ operator: 'notEqual', value: '*x*' })).toEqual({
      kind: 'notContains',
      text: 'x',
    })
    expect(conditionShown({ operator: 'greaterThan', value: '5' })).toEqual({
      kind: 'greaterThan',
      text: '5',
    })
  })

  it('keeps a star somebody typed as a star', () => {
    // A part number with an asterisk in it is a thing people filter for.
    const condition = conditionFor('contains', 'A*B')
    expect(condition.value).toBe('*A~*B*')
    expect(conditionShown(condition)).toEqual({ kind: 'contains', text: 'A~*B' })
  })

  it('replaces a list with a condition rather than keeping both', () => {
    // The file holds one or the other; keeping both would be a state no
    // spreadsheet can save.
    toggleFilter(open, sheet, { row: 1, column: 0 })
    filterColumn(open, sheet, 0, { kind: 'values', values: ['January'], blanks: false })
    filterColumn(open, sheet, 0, {
      kind: 'conditions',
      all: false,
      conditions: [conditionFor('contains', 'Feb')],
    })

    expect(sheet.sheet.autoFilter?.columns[0]?.criteria.kind).toBe('conditions')
    expect(sheet.sheet.autoFilter?.columns).toHaveLength(1)
  })
})
