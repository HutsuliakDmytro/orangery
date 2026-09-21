import { describe, expect, it } from 'vitest'
import { readValidations, replaceValidations, validationAt, writeValidations } from './validation'

/**
 * What a cell is allowed to hold.
 *
 * The attribute worth the words is `showDropDown`, which means the opposite
 * of what it says: `showDropDown="1"` hides the arrow. A reader that took it
 * at face value would put arrows on every cell that asked for none.
 */

const sheet = (inside: string) =>
  `<?xml version="1.0"?><worksheet><sheetData/>${inside}</worksheet>`

const listed = sheet(
  '<dataValidations count="1">' +
    '<dataValidation type="list" allowBlank="1" sqref="B2:B9">' +
    '<formula1>"North,South,East,West"</formula1>' +
    '</dataValidation>' +
    '</dataValidations>',
)

describe('reading the rules of a sheet', () => {
  it('reads a list of values somebody typed in', () => {
    const [rule] = readValidations(listed)

    expect(rule).toMatchObject({
      kind: 'list',
      allowBlank: true,
      formula1: '"North,South,East,West"',
      severity: 'stop',
    })
    expect(rule?.ranges[0]).toMatchObject({
      from: { row: 1, column: 1 },
      to: { row: 8, column: 1 },
    })
  })

  it('puts an arrow on a cell that asked for one', () => {
    // The attribute is stored as what it does rather than as what it says.
    expect(readValidations(listed)[0]?.dropDown).toBe(true)

    const hidden = sheet(
      '<dataValidations><dataValidation type="list" showDropDown="1" sqref="A1"/></dataValidations>',
    )
    expect(readValidations(hidden)[0]?.dropDown).toBe(false)
  })

  it('reads a rule about numbers, with both of its operands', () => {
    const between = sheet(
      '<dataValidations><dataValidation type="whole" operator="between" sqref="A1:A9">' +
        '<formula1>1</formula1><formula2>100</formula2></dataValidation></dataValidations>',
    )

    expect(readValidations(between)[0]).toMatchObject({
      kind: 'whole',
      operator: 'between',
      formula1: '1',
      formula2: '100',
    })
  })

  it('reads what to say when somebody types the wrong thing', () => {
    const told = sheet(
      '<dataValidations><dataValidation type="whole" errorStyle="warning" showErrorMessage="1" ' +
        'errorTitle="Too big" error="Nothing over a hundred." sqref="A1"/></dataValidations>',
    )

    expect(readValidations(told)[0]).toMatchObject({
      severity: 'warning',
      errorTitle: 'Too big',
      errorMessage: 'Nothing over a hundred.',
    })
  })

  it('reads several rectangles from one rule', () => {
    const spread = sheet(
      '<dataValidations><dataValidation type="list" sqref="A1:A3 C1:C3"/></dataValidations>',
    )

    expect(readValidations(spread)[0]?.ranges).toHaveLength(2)
  })

  it('says nothing about a sheet with no rules', () => {
    expect(readValidations(sheet(''))).toEqual([])
  })
})

describe('which rule covers a cell', () => {
  const rules = readValidations(
    sheet(
      '<dataValidations>' +
        '<dataValidation type="whole" sqref="A1:C9"/>' +
        '<dataValidation type="list" sqref="B2:B3"><formula1>"a,b"</formula1></dataValidation>' +
        '</dataValidations>',
    ),
  )

  it('is the last one laid over it, as in Excel', () => {
    // A rule over another is a rule somebody added later.
    expect(validationAt(rules, { row: 1, column: 1 })?.kind).toBe('list')
    expect(validationAt(rules, { row: 5, column: 1 })?.kind).toBe('whole')
  })

  it('is nothing at all for a cell nobody has said anything about', () => {
    expect(validationAt(rules, { row: 50, column: 50 })).toBeNull()
  })
})

describe('writing them back', () => {
  it('comes back the same through a round trip', () => {
    const rules = readValidations(listed)
    const again = readValidations(sheet(writeValidations(rules)))

    expect(again).toEqual(rules)
  })

  it('writes the attribute the way the file says it', () => {
    const rules = readValidations(listed)
    const first = rules[0]
    if (first === undefined) throw new Error('the fixture has no rules')

    const hidden = [{ ...first, dropDown: false }]

    expect(writeValidations(rules)).not.toContain('showDropDown')
    expect(writeValidations(hidden)).toContain('showDropDown="1"')
  })

  it('writes nothing at all for a sheet with no rules', () => {
    expect(writeValidations([])).toBe('')
    expect(replaceValidations(sheet(''), '')).toBe(sheet(''))
  })

  it('puts them where the schema says they go', () => {
    // Before the hyperlinks and after the merges: an element out of order is
    // a file Excel offers to repair.
    const before = sheet('<mergeCells count="0"/><hyperlinks/>')
    const after = replaceValidations(before, '<dataValidations/>')

    expect(after.indexOf('<dataValidations/>')).toBeGreaterThan(after.indexOf('<mergeCells'))
    expect(after.indexOf('<dataValidations/>')).toBeLessThan(after.indexOf('<hyperlinks'))
  })

  it('replaces the ones that were there rather than adding more', () => {
    const after = replaceValidations(listed, '<dataValidations count="0"/>')

    expect(after).toContain('<dataValidations count="0"/>')
    expect(after).not.toContain('North,South')
  })
})
