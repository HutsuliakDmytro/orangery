import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { cellAt, parseRange, regionAround } from '@orangery/ooxml-spreadsheet'
import { singleCell } from '@orangery/grid'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { applyEdit } from './edit'
import { looksLikeHeader, sortRows } from './sort'
import { emptyHistory, recorded, undo } from './history'

/**
 * Putting rows in order.
 *
 * Whole rows move together, which is the whole of what makes sorting safe: a
 * table sorted column by column is a table whose rows no longer mean
 * anything. The rest of the cases here are about what a spreadsheet's order
 * actually is — numbers before words, blanks last whichever way it runs — and
 * about what happens to a formula that has moved.
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

const at = (row: number, column: number) => cellAt(sheet.cells, { row, column })

const range = (text: string) => {
  const parsed = parseRange(text)
  if (parsed === null) throw new Error(`${text} is not a range`)
  return parsed
}

/** A small table of its own, well clear of the fixture's own cells. */
const table = (rows: (string | null)[][]) => {
  for (const [offset, cells] of rows.entries()) {
    for (const [column, value] of cells.entries()) {
      if (value !== null) applyEdit(open, sheet, { row: 10 + offset, column }, value)
    }
  }

  return range(
    `A11:${String.fromCharCode(65 + (rows[0]?.length ?? 1) - 1)}${String(10 + rows.length)}`,
  )
}

describe('the order a spreadsheet puts things in', () => {
  it('sorts numbers as numbers and not as words', () => {
    // As text, 100 would come before 9.
    const where = table([['9'], ['100'], ['20']])
    sortRows(open, sheet, where, [{ column: 0, ascending: true }], false)

    expect([at(10, 0)?.value, at(11, 0)?.value, at(12, 0)?.value]).toEqual(['9', '20', '100'])
  })

  it('puts numbers before words', () => {
    const where = table([['pear'], ['2'], ['apple'], ['1']])
    sortRows(open, sheet, where, [{ column: 0, ascending: true }], false)

    expect([at(10, 0)?.value, at(11, 0)?.value]).toEqual(['1', '2'])
    expect(at(12, 0)?.value).toBe('apple')
  })

  it('leaves the blanks at the bottom whichever way it runs', () => {
    // A column with gaps sorted downwards would otherwise begin with the gaps.
    const where = table([['b'], [null], ['a']])
    sortRows(open, sheet, where, [{ column: 0, ascending: false }], false)

    expect([at(10, 0)?.value, at(11, 0)?.value]).toEqual(['b', 'a'])
    expect(at(12, 0)).toBeNull()
  })

  it('sorts words by what they say, not by where they are stored', () => {
    // A shared string is an index; sorting by it would sort by the order the
    // words were first typed anywhere in the workbook.
    sortRows(open, sheet, range('A2:C3'), [{ column: 0, ascending: false }], false)

    // January and February; Z to A puts January first.
    expect(at(1, 0)?.value).toBe('2')
    expect(at(2, 0)?.value).toBe('3')
  })
})

describe('what moves with a row', () => {
  it('takes every column of the range, not just the one sorted on', () => {
    const where = table([
      ['b', 'two'],
      ['a', 'one'],
    ])
    sortRows(open, sheet, where, [{ column: 0, ascending: true }], false)

    expect([at(10, 0)?.value, at(10, 1)?.value]).toEqual(['a', 'one'])
    expect([at(11, 0)?.value, at(11, 1)?.value]).toEqual(['b', 'two'])
  })

  it('moves a formula’s references by as far as the row moved', () => {
    // Sorting is a move: a formula that said `A11*2` in row 11 says `A12*2`
    // in row 12.
    const where = table([
      ['b', null],
      ['a', null],
    ])
    applyEdit(open, sheet, { row: 10, column: 1 }, '=A11')
    sheet.cells.rows.get(10)?.set(1, {
      row: 10,
      column: 1,
      type: 'n',
      value: '0',
      style: null,
      formula: { text: 'A11*2', kind: 'normal', shared: null, ref: null },
      rich: null,
      carried: null,
    })

    sortRows(open, sheet, where, [{ column: 0, ascending: true }], false)

    expect(at(11, 1)?.formula?.text).toBe('A12*2')
  })

  it('leaves a header row where it is', () => {
    const where = table([['Name'], ['b'], ['a']])
    sortRows(open, sheet, where, [{ column: 0, ascending: true }], true)

    expect(at(10, 0)?.value).toBe('Name')
    expect(at(11, 0)?.value).toBe('a')
  })

  it('keeps the order of rows that compare the same', () => {
    // Which is what makes sorting by one column and then another work.
    const where = table([
      ['a', 'first'],
      ['a', 'second'],
    ])
    sortRows(open, sheet, where, [{ column: 0, ascending: true }], false)

    expect([at(10, 1)?.value, at(11, 1)?.value]).toEqual(['first', 'second'])
  })
})

describe('guessing at a header', () => {
  it('says yes to words on top of numbers', () => {
    expect(looksLikeHeader(open, sheet, table([['Month'], ['1'], ['2']]))).toBe(true)
  })

  it('says no when the column is words all the way down', () => {
    expect(looksLikeHeader(open, sheet, table([['a'], ['b'], ['c']]))).toBe(false)
  })

  it('says no to a table too short to tell', () => {
    expect(looksLikeHeader(open, sheet, table([['Month'], ['1']]))).toBe(false)
  })
})

describe('the table a single cell belongs to', () => {
  it('reaches as far as the filled cells go, and no further', () => {
    const found = regionAround(sheet.cells, { row: 1, column: 1 })

    expect(found.from).toEqual({ row: 0, column: 0 })
    expect(found.to).toEqual({ row: 3, column: 2 })
  })

  it('is one cell where there is nothing around it', () => {
    const found = regionAround(sheet.cells, { row: 20, column: 20 })
    expect(found.from).toEqual(found.to)
  })
})

describe('taking a sort back', () => {
  it('puts every row where it was', () => {
    const where = table([['b'], ['a'], ['c']])
    const before = [at(10, 0), at(11, 0), at(12, 0)]

    const history = recorded(emptyHistory(), {
      changes: sortRows(open, sheet, where, [{ column: 0, ascending: true }], false),
      selection: singleCell({ row: 10, column: 0 }),
    })
    expect(at(10, 0)?.value).toBe('a')

    undo(open, history)
    expect([at(10, 0), at(11, 0), at(12, 0)]).toEqual(before)
  })
})
