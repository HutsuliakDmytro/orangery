import { describe, expect, it } from 'vitest'
import { getPartText } from '@orangery/ooxml-core'
import { isValidName, replaceDefinedNames, writeDefinedNames } from './names-edit'
import { readWorkbook } from './workbook'
import { newWorkbook } from './new-workbook'

/**
 * The names a workbook gives to formulas.
 *
 * A name is not a cell and not a range: it is a formula somebody has named,
 * which is why `Tax_Rate` can stand for `0.2` and `Sales` for a column.
 */

const workbook = () => newWorkbook([{ name: 'Sheet1', rows: [[1]] }])

describe('what a workbook will accept as a name', () => {
  it('takes the ones people write', () => {
    expect(isValidName('Tax_Rate')).toBe(true)
    expect(isValidName('Sales')).toBe(true)
    expect(isValidName('_hidden')).toBe(true)
    expect(isValidName('Rates.2024')).toBe(true)
  })

  it('refuses the ones a formula could not tell from a reference', () => {
    // `A1` as a name would be ambiguous in every formula that used it.
    expect(isValidName('A1')).toBe(false)
    expect(isValidName('$B$2')).toBe(false)
    expect(isValidName('R')).toBe(false)
    expect(isValidName('C')).toBe(false)
  })

  it('refuses the ones that would end where they do not mean to', () => {
    expect(isValidName('Tax Rate')).toBe(false)
    expect(isValidName('2024')).toBe(false)
    expect(isValidName('')).toBe(false)
    expect(isValidName('a'.repeat(256))).toBe(false)
  })
})

describe('writing them into a workbook', () => {
  it('comes back the way it went in', () => {
    const pkg = workbook()
    const names = [
      { name: 'Tax_Rate', formula: '0.2', sheet: null, hidden: false },
      { name: 'Sales', formula: 'Sheet1!$A$1:$A$9', sheet: 0, hidden: false },
    ]

    expect(writeDefinedNames(pkg, names)).toBe(true)
    expect(readWorkbook(pkg)?.definedNames).toEqual(names)
  })

  it('takes them all away when there are none left', () => {
    const pkg = workbook()
    writeDefinedNames(pkg, [{ name: 'Tax_Rate', formula: '0.2', sheet: null, hidden: false }])
    writeDefinedNames(pkg, [])

    expect(readWorkbook(pkg)?.definedNames).toEqual([])
    expect(getPartText(pkg, 'xl/workbook.xml')).not.toContain('definedNames')
  })

  it('escapes a formula with an ampersand in it', () => {
    const pkg = workbook()
    writeDefinedNames(pkg, [
      { name: 'Joined', formula: 'Sheet1!$A$1&" and"', sheet: null, hidden: false },
    ])

    expect(readWorkbook(pkg)?.definedNames[0]?.formula).toBe('Sheet1!$A$1&" and"')
  })

  it('puts the element where the schema says it goes', () => {
    // After the sheets and before the calculation properties: an element out
    // of order is a file Excel offers to repair.
    const xml = '<workbook><sheets><sheet/></sheets><calcPr/></workbook>'
    const written = replaceDefinedNames(xml, '<definedNames/>')

    expect(written.indexOf('<definedNames/>')).toBeGreaterThan(written.indexOf('</sheets>'))
    expect(written.indexOf('<definedNames/>')).toBeLessThan(written.indexOf('<calcPr'))
  })
})
