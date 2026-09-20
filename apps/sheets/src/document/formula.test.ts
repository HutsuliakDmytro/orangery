import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { cellAt, putCell } from '@orangery/ooxml-spreadsheet'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { applyEdit } from './edit'
import {
  applyReport,
  cellsOf,
  heldOf,
  inputsFor,
  moment,
  outOfSight,
  shownAs,
  typedFormula,
} from './formula'
import { cellChanges } from './history'

/**
 * The seam between the sheet on screen and the engine behind it.
 *
 * Nothing here talks to Rust: what is tested is the half that decides what to
 * say and what to do with the answer. Whether `=A1+1` is a formula, what a
 * cell is worth as a value, which cells a step of history moved and which way
 * round, and what a worked-out answer does to the cell that asked for it.
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

describe('what counts as a formula', () => {
  it('is anything after an equals sign', () => {
    expect(typedFormula('=A1+1')).toBe('A1+1')
    expect(typedFormula('=SUM(A1:A9)')).toBe('SUM(A1:A9)')
    expect(typedFormula('= A1 + 1')).toBe(' A1 + 1')
  })

  it('is not an equals sign on its own', () => {
    // Somebody who has begun and stopped. Storing it as a formula would mean
    // storing something with nothing in it.
    expect(typedFormula('=')).toBeNull()
    expect(typedFormula('=  ')).toBeNull()
  })

  it('is not a word that happens to contain one', () => {
    expect(typedFormula('1+1')).toBeNull()
    expect(typedFormula('a=b')).toBeNull()
    expect(typedFormula('')).toBeNull()
  })
})

describe('typing a formula into a cell', () => {
  const at = { row: 8, column: 5 }

  it('keeps the formula and leaves the value to the engine', () => {
    applyEdit(open, sheet, at, '=A1+1')

    expect(cellAt(sheet.cells, at)).toMatchObject({
      formula: { text: 'A1+1', kind: 'normal' },
      value: null,
    })
  })

  it('leaves the cell looking the way it looked', () => {
    // Typing a formula into a currency column is filling it in, not
    // restyling it.
    applyEdit(open, sheet, { row: 3, column: 1 }, '=1+1')
    const before = cellAt(sheet.cells, { row: 4, column: 1 })

    expect(cellAt(sheet.cells, { row: 3, column: 1 })?.style).toBe(before?.style ?? null)
  })

  it('replaces whatever was computing the old value', () => {
    applyEdit(open, sheet, at, '=A1+1')
    applyEdit(open, sheet, at, '42')

    expect(cellAt(sheet.cells, at)).toMatchObject({ type: 'n', value: '42', formula: null })
  })
})

describe('what a cell is worth to the engine', () => {
  it('is a number when it holds one', () => {
    expect(heldOf(open, { ...blank(), type: 'n', value: '42' })).toEqual({
      kind: 'number',
      number: 42,
    })
  })

  it('tells a number apart from a word that looks like one', () => {
    expect(heldOf(open, { ...blank(), type: 'inlineStr', value: '42' })).toEqual({
      kind: 'text',
      text: '42',
    })
  })

  it('is nothing at all when the cell is empty', () => {
    expect(heldOf(open, null)).toEqual({ kind: 'blank' })
    expect(heldOf(open, { ...blank(), type: 'n', value: null })).toEqual({ kind: 'blank' })
  })

  it('carries an error as the error it is', () => {
    expect(heldOf(open, { ...blank(), type: 'e', value: '#DIV/0!' })).toEqual({
      kind: 'error',
      text: '#DIV/0!',
    })
  })

  it('carries a boolean as one', () => {
    expect(heldOf(open, { ...blank(), type: 'b', value: '1' })).toEqual({
      kind: 'boolean',
      boolean: true,
    })
  })
})

describe('what an answer does to the cell that asked for it', () => {
  it('shows a number as a number', () => {
    expect(shownAs({ kind: 'number', number: 6 })).toEqual({ type: 'n', value: '6' })
  })

  it('shows a formula that came to nothing as nought', () => {
    // Which is what Excel shows for `=A1` over an empty A1: the cell it
    // points at is empty, and the sum of nothing is nought.
    expect(shownAs({ kind: 'blank' })).toEqual({ type: 'n', value: '0' })
  })

  it('shows a text answer as a formula string rather than an inline one', () => {
    expect(shownAs({ kind: 'text', text: 'North' })).toEqual({ type: 'str', value: 'North' })
  })

  it('shows an error as the error', () => {
    expect(shownAs({ kind: 'error', text: '#N/A' })).toEqual({ type: 'e', value: '#N/A' })
  })
})

describe('putting a report back into the workbook', () => {
  const at = { row: 8, column: 5 }

  it('replaces what a formula comes to and keeps the formula', () => {
    applyEdit(open, sheet, at, '=1+1')

    const touched = applyReport(open, {
      cells: [
        { sheet: sheet.name, row: at.row, column: at.column, value: { kind: 'number', number: 2 } },
      ],
      circular: [],
      refused: null,
    })

    expect(touched).toEqual([sheet.path])
    expect(cellAt(sheet.cells, at)).toMatchObject({
      type: 'n',
      value: '2',
      formula: { text: '1+1' },
    })
  })

  it('leaves alone a cell that is not there', () => {
    const touched = applyReport(open, {
      cells: [{ sheet: sheet.name, row: 300, column: 9, value: { kind: 'number', number: 2 } }],
      circular: [],
      refused: null,
    })

    expect(touched).toEqual([])
    expect(cellAt(sheet.cells, { row: 300, column: 9 })).toBeNull()
  })

  it('says nothing changed when nothing did', () => {
    putCell(sheet.cells, { ...blank(), row: 8, column: 6, type: 'n', value: '2' })

    const touched = applyReport(open, {
      cells: [{ sheet: sheet.name, row: 8, column: 6, value: { kind: 'number', number: 2 } }],
      circular: [],
      refused: null,
    })

    expect(touched).toEqual([])
  })
})

describe('which cells a step of history moved', () => {
  const at = { row: 8, column: 5 }

  it('tells the engine what they became, and what they were', () => {
    const change = applyEdit(open, sheet, at, '=A1+1')
    if (change === null) throw new Error('the edit changed nothing')

    const forwards = inputsFor(open, cellChanges([change]), 'after')
    expect(forwards).toHaveLength(1)
    expect(forwards[0]?.sheet).toBe(sheet.name)
    expect(forwards[0]?.input?.formula).toBe('A1+1')

    // Undo puts back what was there, and the engine has to be told the same
    // thing the sheet was told.
    const backwards = inputsFor(open, cellChanges([change]), 'before')
    expect(backwards[0]?.input?.formula).toBeUndefined()
  })

  it('says a cell was emptied by naming it with nothing in it', () => {
    const change = applyEdit(open, sheet, { row: 100, column: 7 }, '42')
    if (change === null) throw new Error('the edit changed nothing')

    const backwards = inputsFor(open, cellChanges([change]), 'before')
    expect(backwards[0]?.input).toBeUndefined()
    expect(backwards[0]).toMatchObject({ row: 100, column: 7 })
  })

  it('passes over the things that are not cells', () => {
    // A column's width changes what a sheet looks like rather than what it
    // comes to.
    const widths = inputsFor(
      open,
      [{ kind: 'columns', sheet: sheet.path, before: [], after: [] }],
      'after',
    )
    expect(widths).toEqual([])
  })
})

describe('which rows are out of sight', () => {
  it('tells a filtered row apart from one somebody hid', () => {
    // A row's `hidden` flag says it cannot be seen and not why, because that
    // is all the file records — and `SUBTOTAL(9,…)` and `SUBTOTAL(109,…)`
    // need to know which is which.
    sheet.cells.properties.set(7, {
      index: 7,
      height: null,
      customHeight: false,
      hidden: true,
      outlineLevel: null,
      style: null,
      collapsed: false,
      carried: null,
    })

    const { filtered, hidden } = outOfSight(open, sheet)
    expect(hidden).toContain(7)
    expect(filtered).not.toContain(7)
  })

  it('says nothing is out of sight on a sheet nobody has touched', () => {
    const { filtered, hidden } = outOfSight(open, sheet)
    expect(filtered).toEqual([])
    expect(hidden).toEqual([])
  })
})

describe('what the engine is told on open', () => {
  it('names the sheets the way a formula names them', () => {
    // Everywhere else a sheet is its part, because a name can change and a
    // part cannot. A formula says `Sheet2!A1`, so here it is the name.
    expect(cellsOf(open).map((one) => one.sheet)).toEqual(open.sheets.map((one) => one.name))
  })

  it('sends every cell of every sheet, formulas included', () => {
    const sheets = cellsOf(open)
    const first = sheets.find((one) => one.sheet === sheet.name)

    expect(sheets).toHaveLength(open.sheets.length)
    expect(first?.cells.length ?? 0).toBeGreaterThan(0)
    expect(first?.cells.every((cell) => typeof cell.row === 'number')).toBe(true)
  })

  it('counts the moment in the workbook own calendar', () => {
    // Four years and a day apart, whichever morning the workbook counts from.
    expect(moment(false) - moment(true)).toBeCloseTo(1462, 3)
    // And somewhere after 2020, which is a way of saying it is a date at all.
    expect(moment(false)).toBeGreaterThan(43831)
  })
})

/** A cell with nothing said about it, for the fields a test does not care about. */
function blank() {
  return {
    row: 0,
    column: 0,
    type: 'n' as const,
    value: null,
    style: null,
    formula: null,
    rich: null,
    carried: null,
  }
}
