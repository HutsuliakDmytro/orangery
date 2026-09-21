import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { cellAt } from '@orangery/ooxml-spreadsheet'
import { singleCell } from '@orangery/grid'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { applyEdit, clearCells } from './edit'
import { reshape, resizeColumns, resizeRows } from './structure'
import { canRedo, canUndo, cellChanges, emptyHistory, recorded, redo, undo } from './history'
import type { History } from './history'

/**
 * Taking things back.
 *
 * The one property worth stating: a step is one thing somebody did, however
 * many cells it touched, and one press of undo takes back exactly that. The
 * rest of the cases here are the ones people notice when they are wrong —
 * landing somewhere else afterwards, a redo that has quietly gone, a cell
 * that comes back as blank rather than as what it was.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let open: OpenWorkbook
let sheet: OpenSheet
let history: History

beforeEach(async () => {
  open = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
  const first = open.sheets[0]
  if (first === undefined) throw new Error('the fixture has no sheets')

  sheet = first
  history = emptyHistory()
})

const at = (row: number, column: number) => cellAt(sheet.cells, { row, column })

/** Types into a cell and records it, the way the store does. */
const type = (row: number, column: number, text: string) => {
  const change = applyEdit(open, sheet, { row, column }, text)
  if (change !== null) {
    history = recorded(history, {
      changes: cellChanges([change]),
      selection: singleCell({ row, column }),
    })
  }
}

describe('one step, one press', () => {
  it('puts a typed-over cell back as it was', () => {
    // A1 held "Month" as a shared string.
    expect(at(0, 0)?.type).toBe('s')
    type(0, 0, 'Rent')
    expect(at(0, 0)?.value).toBe('Rent')

    undo(open, history)
    expect(at(0, 0)).toMatchObject({ type: 's', value: '0' })
  })

  it('takes a cell away again that was not there before', () => {
    type(8, 5, '42')
    expect(at(8, 5)).not.toBeNull()

    undo(open, history)
    expect(at(8, 5)).toBeNull()
  })

  it('takes back a hundred cells cleared at once as one thing', () => {
    const cells = Array.from({ length: 4 }, (_, row) =>
      Array.from({ length: 3 }, (_, column) => ({ row, column })),
    ).flat()

    const changes = clearCells(sheet, cells)
    history = recorded(history, {
      changes: cellChanges(changes),
      selection: singleCell({ row: 0, column: 0 }),
    })

    expect(at(1, 1)).toBeNull()
    expect(changes.length).toBeGreaterThan(1)

    const moved = undo(open, history)

    expect(at(1, 1)?.value).toBe('1234.5')
    expect(at(0, 0)?.value).toBe('0')
    // One press, not one per cell.
    expect(canUndo(moved.history)).toBe(false)
  })
})

describe('going back and forth', () => {
  it('walks back through the steps one at a time', () => {
    type(8, 5, 'one')
    type(8, 5, 'two')
    type(8, 5, 'three')

    let moved = undo(open, history)
    expect(at(8, 5)?.value).toBe('two')

    moved = undo(open, moved.history)
    expect(at(8, 5)?.value).toBe('one')

    moved = undo(open, moved.history)
    expect(at(8, 5)).toBeNull()
    expect(canUndo(moved.history)).toBe(false)
  })

  it('puts back what it took, in the order it took it', () => {
    type(8, 5, 'one')
    type(8, 5, 'two')

    const back = undo(open, undo(open, history).history)
    expect(at(8, 5)).toBeNull()

    const forward = redo(open, back.history)
    expect(at(8, 5)?.value).toBe('one')

    redo(open, forward.history)
    expect(at(8, 5)?.value).toBe('two')
  })

  it('abandons the future the moment something new is done', () => {
    // There is one past, and it is the one you are in.
    type(8, 5, 'one')
    const back = undo(open, history)
    expect(canRedo(back.history)).toBe(true)

    history = back.history
    type(8, 5, 'other')

    expect(canRedo(history)).toBe(false)
  })
})

describe('where it leaves the cursor', () => {
  it('puts it back where the step began', () => {
    // Landing somewhere else is how a person loses their place in a sheet
    // they were halfway through.
    const change = applyEdit(open, sheet, { row: 8, column: 5 }, '42')
    if (change === null) throw new Error('nothing was typed')

    history = recorded(history, {
      changes: cellChanges([change]),
      selection: singleCell({ row: 8, column: 5 }),
    })
    const moved = undo(open, history)

    expect(moved.selection?.active).toEqual({ row: 8, column: 5 })
  })

  it('says which sheets changed, so only those are redrawn', () => {
    type(8, 5, '42')
    expect(undo(open, history).sheets).toEqual(new Set([sheet.path]))
  })
})

describe('a history with nothing in it', () => {
  it('does nothing, and says nothing moved', () => {
    const moved = undo(open, emptyHistory())

    expect(moved.selection).toBeNull()
    expect(moved.sheets.size).toBe(0)
  })

  it('does not record a step that changed nothing', () => {
    // Typing the same thing again, or emptying a cell that was already empty:
    // a step that changed nothing is a step undo would appear to skip.
    expect(applyEdit(open, sheet, { row: 8, column: 5 }, '')).toBeNull()
    expect(
      recorded(emptyHistory(), { changes: [], selection: singleCell({ row: 0, column: 0 }) }),
    ).toMatchObject({ past: [] })
  })
})

describe('how much is kept', () => {
  it('remembers a hundred steps and forgets the oldest', () => {
    // A step can hold a hundred thousand cells; an unbounded history of those
    // is a window that runs out of memory for having been used all afternoon.
    for (let index = 0; index < 120; index += 1) type(8, 5, String(index))

    expect(history.past).toHaveLength(100)
    // The first twenty are gone, so the oldest one left restores 19.
    let moved = { history }
    for (let index = 0; index < 100; index += 1) moved = undo(open, moved.history)

    expect(at(8, 5)?.value).toBe('19')
  })
})

describe('things that are not cells', () => {
  it('takes back a column’s width', () => {
    // A width belongs to a column, not to any cell in it. A history that only
    // knew cells would take back the last thing typed instead.
    const before = sheet.sheet.columns

    const history = recorded(emptyHistory(), {
      changes: resizeColumns(sheet, 1, 1, { width: 44, custom: true }),
      selection: singleCell({ row: 0, column: 1 }),
    })
    expect(sheet.sheet.columns).not.toEqual(before)

    undo(open, history)
    expect(sheet.sheet.columns).toEqual(before)
  })

  it('takes back hiding a row, and hides it again on redo', () => {
    const history = recorded(emptyHistory(), {
      changes: resizeRows(sheet, 2, 2, { hidden: true }),
      selection: singleCell({ row: 2, column: 0 }),
    })
    expect(sheet.cells.properties.get(2)?.hidden).toBe(true)

    const back = undo(open, history)
    expect(sheet.cells.properties.get(2)?.hidden ?? false).toBe(false)

    redo(open, back.history)
    expect(sheet.cells.properties.get(2)?.hidden).toBe(true)
  })

  it('takes a row’s properties away again where there were none', () => {
    // Row 9 of the fixture has no entry at all; hiding it makes one, and
    // undoing has to leave none rather than an entry saying "not hidden".
    expect(sheet.cells.properties.has(8)).toBe(false)

    const history = recorded(emptyHistory(), {
      changes: resizeRows(sheet, 8, 8, { hidden: true }),
      selection: singleCell({ row: 8, column: 0 }),
    })
    undo(open, history)

    expect(sheet.cells.properties.has(8)).toBe(false)
  })

  it('puts the heights back when a row insertion is taken back', () => {
    // Row 2 is thirty points tall; inserting above it moves that down, and
    // undoing has to bring it back up.
    const history = recorded(emptyHistory(), {
      changes: reshape(open, sheet, { axis: 'row', at: 0, by: 1 }),
      selection: singleCell({ row: 0, column: 0 }),
    })
    expect(sheet.cells.properties.get(2)?.height).toBe(30)

    undo(open, history)
    expect(sheet.cells.properties.get(1)?.height).toBe(30)
    expect(sheet.cells.properties.get(2)?.height ?? null).toBeNull()
  })

  it('says which sheet a column change was on, so only it is redrawn', () => {
    const history = recorded(emptyHistory(), {
      changes: resizeColumns(sheet, 0, 0, { width: 12 }),
      selection: singleCell({ row: 0, column: 0 }),
    })

    expect(undo(open, history).sheets).toEqual(new Set([sheet.path]))
  })
})
