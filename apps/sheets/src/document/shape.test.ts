import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { formatReference, parseRange } from '@orangery/ooxml-spreadsheet'
import type { CellRange, ConditionalRule, DataValidation, Table } from '@orangery/ooxml-spreadsheet'
import { getPartText } from '@orangery/ooxml-core'
import { singleCell } from '@orangery/grid'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { reshape } from './structure'
import { emptyHistory, recorded, undo } from './history'
import { makeTable } from './tables'
import { workbookBytes } from './save'

/**
 * What moves on a sheet besides its cells.
 *
 * The rectangles: the merges, the conditional rules, the validations, the
 * filter, the links, the tables, the sparklines. None of them are cells and
 * none of them move because a cell did, which is why a sheet that shifted
 * only its cells came back with its colours on the wrong rows.
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

const range = (text: string): CellRange => {
  const parsed = parseRange(text)
  if (parsed === null) throw new Error(`${text} is not a range`)
  return parsed
}

const shown = (one: CellRange | undefined): string | undefined =>
  one === undefined ? undefined : `${formatReference(one.from)}:${formatReference(one.to)}`

const insertRow = (at: number, by = 1) => reshape(open, sheet, { axis: 'row', at, by })
const insertColumn = (at: number, by = 1) => reshape(open, sheet, { axis: 'column', at, by })

const rule = (over: readonly string[], formula: string): ConditionalRule[] => {
  sheet.sheet.conditional = [
    {
      ranges: over.map(range),
      rules: [
        {
          type: 'expression',
          priority: 1,
          stopIfTrue: false,
          dxfId: 0,
          operator: null,
          text: null,
          formulas: [formula],
          rank: null,
          percent: false,
          bottom: false,
          above: false,
          equalAverage: false,
          standardDeviation: null,
          timePeriod: null,
          colorScale: null,
          dataBar: null,
          iconSet: null,
        },
      ],
    },
  ]
  return sheet.sheet.conditional[0]?.rules ?? []
}

describe('merges', () => {
  it('move when the rows above them do', () => {
    sheet.sheet.merges = [range('B5:D5')]
    insertRow(0, 2)

    expect(shown(sheet.sheet.merges[0])).toBe('B7:D7')
  })

  it('grow when a row goes in inside them', () => {
    sheet.sheet.merges = [range('B5:D8')]
    insertRow(5)

    expect(shown(sheet.sheet.merges[0])).toBe('B5:D9')
  })

  it('are gone when every row of them is deleted', () => {
    sheet.sheet.merges = [range('B5:D6')]
    reshape(open, sheet, { axis: 'row', at: 4, by: -2 })

    expect(sheet.sheet.merges).toHaveLength(0)
  })
})

describe('conditional rules', () => {
  it('move with the cells they were about', () => {
    rule(['B5:B9'], 'B5>100')
    insertRow(0, 2)

    expect(shown(sheet.sheet.conditional[0]?.ranges[0])).toBe('B7:B11')
  })

  it('rewrite the formula a rule is, because it is a formula', () => {
    // `=$B2>TODAY()` names a cell like anything else does.
    rule(['B5:B9'], '$B5>TODAY()')
    insertRow(0, 2)

    expect(sheet.sheet.conditional[0]?.rules[0]?.formulas[0]).toBe('$B7>TODAY()')
  })

  it('keep the ranges that survived and drop the ones that did not', () => {
    rule(['B1:B2', 'B5:B6'], 'TRUE()')
    reshape(open, sheet, { axis: 'row', at: 4, by: -2 })

    expect(sheet.sheet.conditional[0]?.ranges).toHaveLength(1)
    expect(shown(sheet.sheet.conditional[0]?.ranges[0])).toBe('B1:B2')
  })
})

describe('validations', () => {
  const validation = (over: string, formula: string): DataValidation => {
    const one: DataValidation = {
      ranges: [range(over)],
      kind: 'list',
      operator: 'between',
      formula1: formula,
      formula2: null,
      allowBlank: true,
      dropDown: true,
      severity: 'stop',
      errorTitle: null,
      errorMessage: null,
      promptTitle: null,
      promptMessage: null,
      carried: null,
    }

    sheet.sheet.validations = [one]
    return one
  }

  it('move, and take their list with them', () => {
    validation('B5:B9', '$H$5:$H$9')
    insertRow(0, 2)

    expect(shown(sheet.sheet.validations[0]?.ranges[0])).toBe('B7:B11')
    expect(sheet.sheet.validations[0]?.formula1).toBe('$H$7:$H$11')
  })

  it('go when the cells they were about go', () => {
    validation('B5:B6', 'TRUE()')
    reshape(open, sheet, { axis: 'row', at: 4, by: -2 })

    expect(sheet.sheet.validations).toHaveLength(0)
  })
})

describe('the filter', () => {
  const filter = (over: string, columns: number[]) => {
    sheet.sheet.autoFilter = {
      range: range(over),
      columns: columns.map((column) => ({
        column,
        criteria: { kind: 'values' as const, values: [], blanks: false },
      })),
    }
  }

  it('keeps its criteria on the columns they were about', () => {
    // A criterion counts from the left of the filter's own range, so a column
    // put inside the range moves every criterion to its right.
    filter('B1:E9', [2])
    insertColumn(3)

    expect(shown(sheet.sheet.autoFilter?.range)).toBe('B1:F9')
    expect(sheet.sheet.autoFilter?.columns[0]?.column).toBe(3)
  })

  it('drops a criterion whose column was deleted', () => {
    filter('B1:E9', [2])
    reshape(open, sheet, { axis: 'column', at: 3, by: -1 })

    expect(sheet.sheet.autoFilter?.columns).toHaveLength(0)
  })
})

describe('tables', () => {
  const table = (over: string, names: string[]): Table => {
    const one: Table = {
      name: 'Table1',
      displayName: 'Table1',
      range: range(over),
      headerRows: 1,
      totalsRows: 0,
      columns: names.map((name, at) => ({
        name,
        id: String(at + 1),
        totalsFunction: null,
        totalsLabel: null,
        formula: null,
      })),
      style: {
        name: 'TableStyleMedium2',
        firstColumn: false,
        lastColumn: false,
        rowStripes: true,
        columnStripes: false,
      },
      filtered: true,
    }

    sheet.tables = [one]
    return one
  }

  it('moves down with the rows under an insertion', () => {
    table('B4:D9', ['One', 'Two', 'Three'])
    insertRow(0, 2)

    expect(shown(sheet.tables[0]?.range)).toBe('B6:D11')
  })

  it('gains a column when one is put inside it, because the file counts them', () => {
    // The range and the column list are two statements of the same width, and
    // a file where they disagree is one Excel offers to repair.
    table('B4:D9', ['One', 'Two', 'Three'])
    insertColumn(3)

    expect(shown(sheet.tables[0]?.range)).toBe('B4:E9')
    expect(sheet.tables[0]?.columns).toHaveLength(4)
    expect(sheet.tables[0]?.columns[2]?.name).toBe('Column1')
  })

  it('loses one when a column of it is taken out', () => {
    table('B4:D9', ['One', 'Two', 'Three'])
    reshape(open, sheet, { axis: 'column', at: 2, by: -1 })

    expect(shown(sheet.tables[0]?.range)).toBe('B4:C9')
    expect(sheet.tables[0]?.columns.map((one) => one.name)).toEqual(['One', 'Three'])
  })

  it('keeps its columns when the insertion is beside it rather than in it', () => {
    table('B4:D9', ['One', 'Two', 'Three'])
    insertColumn(1)

    expect(shown(sheet.tables[0]?.range)).toBe('C4:E9')
    expect(sheet.tables[0]?.columns).toHaveLength(3)
  })

  it('goes when every column of it goes', () => {
    table('B4:D9', ['One', 'Two', 'Three'])
    reshape(open, sheet, { axis: 'column', at: 1, by: -3 })

    expect(sheet.tables).toHaveLength(0)
  })
})

describe('links', () => {
  it('move with the cells that were the link', () => {
    sheet.links = [
      {
        range: range('B5:B5'),
        target: 'https://example.com',
        location: null,
        tooltip: null,
        relationshipId: 'rId9',
      },
    ]
    insertRow(0, 2)

    expect(shown(sheet.links[0]?.range)).toBe('B7:B7')
  })
})

describe('sparklines', () => {
  it('move with the cell they are drawn in and the cells they are drawn from', () => {
    sheet.sheet.sparklines = [
      {
        kind: 'line',
        color: null,
        negativeColor: null,
        emptyAs: 'gap',
        sparklines: [{ cell: { row: 4, column: 5 }, formula: 'Budget!B5:E5' }],
      },
    ]
    insertRow(0, 2)

    const one = sheet.sheet.sparklines[0]?.sparklines[0]
    expect(one?.cell).toEqual({ row: 6, column: 5 })
    expect(one?.formula).toBe('Budget!B7:E7')
  })
})

describe('taking a change of shape back', () => {
  it('puts every rectangle where it was', () => {
    sheet.sheet.merges = [range('B5:D5')]
    rule(['B5:B9'], 'B5>100')
    const before = { merges: sheet.sheet.merges, conditional: sheet.sheet.conditional }

    const history = recorded(emptyHistory(), {
      changes: insertRow(0, 2),
      selection: singleCell({ row: 0, column: 0 }),
    })
    undo(open, history)

    expect(sheet.sheet.merges).toBe(before.merges)
    expect(sheet.sheet.conditional).toBe(before.conditional)
  })
})

describe('a table that moved, written back', () => {
  it('says where it is in its own part, and reads back there', async () => {
    // A table keeps its range in a part of its own, so moving one in the
    // model is only half of moving it.
    const made = makeTable(open, sheet, {
      anchor: { row: 0, column: 0 },
      focus: { row: 4, column: 2 },
    })
    expect(made).not.toBeNull()

    reshape(open, sheet, { axis: 'row', at: 0, by: 2 })
    expect(getPartText(open.pkg, 'xl/tables/table1.xml')).toContain('ref="A3:C7"')

    const again = await openWorkbook(await workbookBytes(open, { edited: true }))
    expect(again.sheets[0]?.tables[0]?.range.from.row).toBe(2)
  })
})
