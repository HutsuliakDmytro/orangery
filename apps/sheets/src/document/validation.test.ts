import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { putCell, readValidations } from '@orangery/ooxml-spreadsheet'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { choicesOf, refusalFor, ruleAt } from './validation'

/**
 * What a cell is allowed to hold.
 *
 * What is tested here is the judging rather than the reading: whether what
 * somebody typed is allowed, what the dropdown offers, and the one kind of
 * rule this deliberately lets through.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let open: OpenWorkbook
let sheet: OpenSheet

const sheetXml = (inside: string) =>
  `<?xml version="1.0"?><worksheet><sheetData/>${inside}</worksheet>`

const withRules = (inside: string) => {
  sheet.validations = readValidations(sheetXml(inside))
}

beforeEach(async () => {
  open = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
  const first = open.sheets[0]
  if (first === undefined) throw new Error('the fixture has no sheets')
  sheet = first
})

describe('a list of choices', () => {
  it('reads the ones typed into the rule', () => {
    withRules(
      '<dataValidations><dataValidation type="list" sqref="H2:H9">' +
        '<formula1>"North, South ,East"</formula1></dataValidation></dataValidations>',
    )

    expect(choicesOf(open, sheet, ruling({ row: 1, column: 7 }))).toEqual([
      'North',
      'South',
      'East',
    ])
  })

  it('reads the ones sitting in a range of the workbook', () => {
    // Which is what people use for a list they can edit, and the reason a
    // dropdown can change without anybody opening a dialog.
    putCell(sheet.cells, cell(40, 7, 'Rent'))
    putCell(sheet.cells, cell(41, 7, 'Food'))

    withRules(
      '<dataValidations><dataValidation type="list" sqref="A1">' +
        '<formula1>$H$41:$H$42</formula1></dataValidation></dataValidations>',
    )

    expect(choicesOf(open, sheet, ruling({ row: 0, column: 0 }))).toEqual(['Rent', 'Food'])
  })

  it('leaves out the gaps somebody left in the middle of one', () => {
    putCell(sheet.cells, cell(40, 7, 'Rent'))
    putCell(sheet.cells, cell(42, 7, 'Food'))

    withRules(
      '<dataValidations><dataValidation type="list" sqref="A1">' +
        '<formula1>$H$41:$H$43</formula1></dataValidation></dataValidations>',
    )

    expect(choicesOf(open, sheet, ruling({ row: 0, column: 0 }))).toEqual(['Rent', 'Food'])
  })
})

describe('whether what was typed is allowed', () => {
  it('takes one of the choices, whatever case it was typed in', () => {
    withRules(
      '<dataValidations><dataValidation type="list" sqref="A1">' +
        '<formula1>"North,South"</formula1></dataValidation></dataValidations>',
    )

    expect(refusalFor(open, sheet, { row: 0, column: 0 }, 'north')).toBeNull()
    expect(refusalFor(open, sheet, { row: 0, column: 0 }, 'West')?.message).toContain('North')
  })

  it('minds the bounds of a number rule', () => {
    withRules(
      '<dataValidations><dataValidation type="whole" operator="between" sqref="A1">' +
        '<formula1>1</formula1><formula2>100</formula2></dataValidation></dataValidations>',
    )

    expect(refusalFor(open, sheet, { row: 0, column: 0 }, '50')).toBeNull()
    expect(refusalFor(open, sheet, { row: 0, column: 0 }, '101')).not.toBeNull()
    // A whole number rule is about whole numbers.
    expect(refusalFor(open, sheet, { row: 0, column: 0 }, '1.5')).not.toBeNull()
    expect(refusalFor(open, sheet, { row: 0, column: 0 }, 'ten')).not.toBeNull()
  })

  it('says what the rule asks for when the rule says nothing itself', () => {
    withRules(
      '<dataValidations><dataValidation type="textLength" operator="lessThanOrEqual" sqref="A1">' +
        '<formula1>3</formula1></dataValidation></dataValidations>',
    )

    expect(refusalFor(open, sheet, { row: 0, column: 0 }, 'abc')).toBeNull()
    expect(refusalFor(open, sheet, { row: 0, column: 0 }, 'abcd')?.message).toBe(
      'This cell takes a value of 3 or less.',
    )
  })

  it('says what the rule says, where it says anything', () => {
    withRules(
      '<dataValidations><dataValidation type="whole" operator="greaterThan" ' +
        'showErrorMessage="1" error="Only positive amounts, please." sqref="A1">' +
        '<formula1>0</formula1></dataValidation></dataValidations>',
    )

    expect(refusalFor(open, sheet, { row: 0, column: 0 }, '-1')?.message).toBe(
      'Only positive amounts, please.',
    )
  })

  it('lets an empty cell through unless the rule says not', () => {
    withRules(
      '<dataValidations><dataValidation type="whole" operator="greaterThan" sqref="A1">' +
        '<formula1>0</formula1></dataValidation></dataValidations>',
    )
    expect(refusalFor(open, sheet, { row: 0, column: 0 }, '')).not.toBeNull()

    withRules(
      '<dataValidations><dataValidation type="whole" operator="greaterThan" allowBlank="1" ' +
        'sqref="A1"><formula1>0</formula1></dataValidation></dataValidations>',
    )
    expect(refusalFor(open, sheet, { row: 0, column: 0 }, '')).toBeNull()
  })

  it('lets through a rule it cannot judge rather than inventing an answer', () => {
    // A custom rule is a formula, and working one out means asking the
    // engine, which answers a moment later while this has to answer now.
    withRules(
      '<dataValidations><dataValidation type="custom" sqref="A1">' +
        '<formula1>LEN(A1)&gt;3</formula1></dataValidation></dataValidations>',
    )

    expect(refusalFor(open, sheet, { row: 0, column: 0 }, 'ab')).toBeNull()
  })

  it('says nothing about a cell nobody has made a rule for', () => {
    expect(refusalFor(open, sheet, { row: 50, column: 50 }, 'anything')).toBeNull()
  })
})

/** The rule on a cell, for a test that would have nothing to say without one. */
const ruling = (at: { row: number; column: number }) => {
  const rule = ruleAt(sheet, at)
  if (rule === null) throw new Error('the sheet has no rule there')

  return rule
}

const cell = (row: number, column: number, value: string) => ({
  row,
  column,
  type: 'inlineStr' as const,
  value,
  style: null,
  formula: null,
  rich: null,
  carried: null,
})
