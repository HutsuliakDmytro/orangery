import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { readPackage } from '@orangery/ooxml-core'
import { readWorksheet } from '@orangery/ooxml-spreadsheet'
import { getPartText } from '@orangery/ooxml-core'
import { openWorkbook } from './workbook'
import type { OpenSheet, OpenWorkbook } from './workbook'
import { addRule, removeRule, ruleSaid, rulesAt } from './rules'
import { workbookBytes } from './save'

/**
 * The rules that change how a cell looks because of what is in it.
 *
 * The awkward half is not the rule but the look: a rule does not carry its
 * colours, it carries a number pointing into a list the workbook keeps.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let open: OpenWorkbook
let sheet: OpenSheet

const over = (top: number, bottom: number) => ({
  active: { row: top, column: 1 },
  ranges: [{ anchor: { row: top, column: 1 }, focus: { row: bottom, column: 1 } }],
})

beforeEach(async () => {
  open = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
  const first = open.sheets[0]
  if (first === undefined) throw new Error('the fixture has no sheets')
  sheet = first
})

describe('making a rule', () => {
  it('points it at a look, adding the look to the workbook', () => {
    const before = open.styleChanges.differentials.length
    const rule = addRule(open, sheet, over(1, 9), {
      kind: 'greaterThan',
      first: '100',
      second: '',
      look: 'red',
    })

    expect(rule).toMatchObject({ type: 'cellIs', operator: 'greaterThan', formulas: ['100'] })
    expect(rule?.dxfId).not.toBeNull()
    expect(open.styleChanges.differentials).toHaveLength(before + 1)
  })

  it('gives two rules of the same colour the same look', () => {
    // A workbook with ten thousand red cells holds one red.
    const first = addRule(open, sheet, over(1, 9), {
      kind: 'greaterThan',
      first: '1',
      second: '',
      look: 'red',
    })
    const added = open.styleChanges.differentials.length

    const second = addRule(open, sheet, over(1, 9), {
      kind: 'lessThan',
      first: '0',
      second: '',
      look: 'red',
    })

    expect(open.styleChanges.differentials).toHaveLength(added)
    expect(second?.dxfId).toBe(first?.dxfId)
  })

  it('puts a new rule first, which is where Excel puts one', () => {
    const first = addRule(open, sheet, over(1, 9), {
      kind: 'greaterThan',
      first: '1',
      second: '',
      look: 'red',
    })
    const second = addRule(open, sheet, over(1, 9), {
      kind: 'lessThan',
      first: '0',
      second: '',
      look: 'green',
    })

    expect(second?.priority ?? 0).toBeLessThan(first?.priority ?? 0)
  })

  it('refuses a rule with nothing to compare against', () => {
    expect(
      addRule(open, sheet, over(1, 9), { kind: 'greaterThan', first: '', second: '', look: 'red' }),
    ).toBeNull()
    expect(
      addRule(open, sheet, over(1, 9), { kind: 'between', first: '1', second: '', look: 'red' }),
    ).toBeNull()
  })

  it('makes the one rule that asks about the range rather than a cell', () => {
    const rule = addRule(open, sheet, over(1, 9), {
      kind: 'duplicateValues',
      first: '',
      second: '',
      look: 'yellow',
    })

    expect(rule?.type).toBe('duplicateValues')
  })
})

describe('the rules on a cell', () => {
  it('lists the ones whose range covers it', () => {
    // The fixture has rules of its own, so what is counted is the change.
    const before = rulesAt(sheet, { row: 5, column: 1 }).length
    addRule(open, sheet, over(1, 9), { kind: 'greaterThan', first: '1', second: '', look: 'red' })

    expect(rulesAt(sheet, { row: 5, column: 1 })).toHaveLength(before + 1)
    expect(rulesAt(sheet, { row: 500, column: 1 })).toHaveLength(0)
  })

  it('says what each one says, in words', () => {
    addRule(open, sheet, over(1, 9), { kind: 'between', first: '1', second: '9', look: 'red' })

    const said = rulesAt(sheet, { row: 5, column: 1 }).map((one) => ruleSaid(one.rule))
    expect(said).toContain('Between 1 and 9')
  })

  it('takes one off, and the block with it when it was the last', () => {
    // A block with no rules is a `sqref` covering cells for no reason.
    const rule = addRule(open, sheet, over(1, 9), {
      kind: 'greaterThan',
      first: '1',
      second: '',
      look: 'red',
    })
    const blocks = sheet.sheet.conditional.length

    expect(removeRule(sheet, rule ?? ({} as never))).toBe(true)
    expect(sheet.sheet.conditional).toHaveLength(blocks - 1)
  })
})

describe('what the file ends up with', () => {
  it('holds the rule and the look it points at', async () => {
    addRule(open, sheet, over(1, 9), { kind: 'greaterThan', first: '100', second: '', look: 'red' })

    const saved = await readPackage(await workbookBytes(open, { edited: true }), 'xl/workbook.xml')
    const rules = readWorksheet(getPartText(saved, sheet.path) ?? '')?.conditional ?? []
    const mine = rules.flatMap((one) => one.rules).filter((one) => one.operator === 'greaterThan')

    expect(mine).toHaveLength(1)
    expect(mine[0]).toMatchObject({ formulas: ['100'] })

    const styles = getPartText(saved, 'xl/styles.xml') ?? ''
    expect(styles).toContain('FFFFC7CE')
  })
})
