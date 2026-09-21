import { describe, expect, it } from 'vitest'
import { getPartText, setPartText } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { newWorkbook } from './new-workbook'
import { readWorkbook } from './workbook'
import {
  addSheet,
  freeName,
  moveSheet,
  removeSheet,
  renameSheet,
  setSheetState,
  setTabColor,
} from './sheets-edit'

/**
 * Adding, removing and rearranging the sheets of a workbook.
 *
 * A sheet is an entry, a relationship, a part and a content type, and what is
 * tested here is that all four stay in step: a package with three of them is
 * a package Excel offers to repair, and the reader is the quickest way to ask
 * whether the four still agree.
 */

const made = (): OoxmlPackage =>
  newWorkbook([
    { name: 'One', rows: [['a']] },
    { name: 'Two', rows: [['b']] },
  ])

const sheetsOf = (pkg: OoxmlPackage) => readWorkbook(pkg)?.sheets ?? []

describe('adding one', () => {
  it('puts it last, where a new sheet goes', () => {
    const pkg = made()
    addSheet(pkg, 'Three')

    expect(sheetsOf(pkg).map((one) => one.name)).toEqual(['One', 'Two', 'Three'])
  })

  it('puts it where it is asked to', () => {
    const pkg = made()
    addSheet(pkg, 'Middle', { at: 1 })

    expect(sheetsOf(pkg).map((one) => one.name)).toEqual(['One', 'Middle', 'Two'])
  })

  it('gives it a part of its own, and says which', () => {
    const pkg = made()
    const added = addSheet(pkg, 'Three')

    expect(added?.path).toBe('xl/worksheets/sheet3.xml')
    expect(getPartText(pkg, added?.path ?? '')).toContain('<sheetData/>')
  })

  it('declares the part, or the package is one Excel repairs', () => {
    const pkg = made()
    const added = addSheet(pkg, 'Three')

    expect(getPartText(pkg, '[Content_Types].xml')).toContain(added?.path ?? 'nothing')
  })

  it('can be found by the reader, which is the test that matters', () => {
    // The entry, the relationship and the part all agreeing is exactly what
    // the reader needs to resolve a sheet to its bytes.
    const pkg = made()
    addSheet(pkg, 'Three')

    expect(sheetsOf(pkg)[2]?.path).toBe('xl/worksheets/sheet3.xml')
  })

  it('will not have two sheets of one name', () => {
    // Excel refuses a workbook with two, so a duplicate gets a number.
    const pkg = made()
    expect(addSheet(pkg, 'One')?.name).toBe('One (2)')
  })

  it('leaves behind what the copy would only have pointed at', () => {
    // A worksheet naming a relationship that was not copied is a file Excel
    // calls damaged.
    const pkg = made()
    const source = 'xl/worksheets/sheet1.xml'
    const xml = getPartText(pkg, source) ?? ''
    setPartText(pkg, source, xml.replace('<sheetData', '<drawing r:id="rId9"/><sheetData'))

    const added = addSheet(pkg, 'Copy', { copyOf: source })

    expect(getPartText(pkg, added?.path ?? '')).not.toContain('drawing')
    expect(getPartText(pkg, added?.path ?? '')).toContain('sheetData')
  })

  it('copies another sheet’s bytes where it is a duplicate', () => {
    const pkg = made()
    const added = addSheet(pkg, 'One copy', { copyOf: 'xl/worksheets/sheet1.xml' })

    expect(getPartText(pkg, added?.path ?? '')).toBe(getPartText(pkg, 'xl/worksheets/sheet1.xml'))
  })
})

describe('taking one away', () => {
  it('leaves the others where they were', () => {
    const pkg = made()
    removeSheet(pkg, 0)

    expect(sheetsOf(pkg).map((one) => one.name)).toEqual(['Two'])
  })

  it('takes the relationship with it', () => {
    const pkg = made()
    removeSheet(pkg, 0)

    expect(getPartText(pkg, 'xl/_rels/workbook.xml.rels')).not.toContain('sheet1.xml')
  })

  it('refuses the last one, because a workbook has to have a sheet', () => {
    const pkg = newWorkbook([{ name: 'Only', rows: [] }])

    expect(removeSheet(pkg, 0)).toBe(false)
    expect(sheetsOf(pkg)).toHaveLength(1)
  })
})

describe('renaming one', () => {
  it('changes the name and nothing else', () => {
    const pkg = made()
    renameSheet(pkg, 1, 'Renamed')

    expect(sheetsOf(pkg).map((one) => one.name)).toEqual(['One', 'Renamed'])
    expect(sheetsOf(pkg)[1]?.path).toBe('xl/worksheets/sheet2.xml')
  })

  it('will not take a name another sheet has', () => {
    const pkg = made()
    expect(renameSheet(pkg, 1, 'One')).toBe('One (2)')
  })

  it('lets a sheet keep its own name', () => {
    const pkg = made()
    expect(renameSheet(pkg, 1, 'Two')).toBe('Two')
  })

  it('escapes a name that would otherwise be markup', () => {
    const pkg = made()
    renameSheet(pkg, 0, 'a & b')

    expect(getPartText(pkg, 'xl/workbook.xml')).toContain('name="a &amp; b"')
    expect(sheetsOf(pkg)[0]?.name).toBe('a & b')
  })
})

describe('moving one', () => {
  it('puts it where it was dropped', () => {
    const pkg = made()
    moveSheet(pkg, 1, 0)

    expect(sheetsOf(pkg).map((one) => one.name)).toEqual(['Two', 'One'])
  })

  it('keeps each sheet pointing at its own part', () => {
    const pkg = made()
    moveSheet(pkg, 1, 0)

    expect(sheetsOf(pkg)[0]?.path).toBe('xl/worksheets/sheet2.xml')
  })

  it('does nothing where there is nowhere to go', () => {
    const pkg = made()
    expect(moveSheet(pkg, 0, 0)).toBe(false)
    expect(moveSheet(pkg, 0, 5)).toBe(false)
  })
})

describe('hiding one', () => {
  it('says so in the workbook', () => {
    const pkg = made()
    setSheetState(pkg, 1, 'hidden')

    expect(sheetsOf(pkg)[1]?.state).toBe('hidden')
  })

  it('brings it back without leaving the attribute behind', () => {
    const pkg = made()
    setSheetState(pkg, 1, 'hidden')
    setSheetState(pkg, 1, 'visible')

    expect(sheetsOf(pkg)[1]?.state).toBe('visible')
    expect(getPartText(pkg, 'xl/workbook.xml')).not.toContain('state=')
  })
})

describe('the colour of a tab', () => {
  const colorOf = (pkg: OoxmlPackage) =>
    /<tabColor rgb="([^"]*)"\/>/u.exec(getPartText(pkg, 'xl/worksheets/sheet1.xml') ?? '')?.[1]

  it('is written into the worksheet, where it lives', () => {
    const pkg = made()
    setTabColor(pkg, 'xl/worksheets/sheet1.xml', 'FFFF7A00')

    expect(colorOf(pkg)).toBe('FFFF7A00')
  })

  it('goes at the front of the part, which is where the schema wants it', () => {
    const pkg = made()
    setTabColor(pkg, 'xl/worksheets/sheet1.xml', 'FF00FF00')
    const xml = getPartText(pkg, 'xl/worksheets/sheet1.xml') ?? ''

    expect(xml.indexOf('<sheetPr>')).toBeLessThan(xml.indexOf('<dimension'))
  })

  it('changes a colour that was already there rather than adding another', () => {
    const pkg = made()
    setTabColor(pkg, 'xl/worksheets/sheet1.xml', 'FF00FF00')
    setTabColor(pkg, 'xl/worksheets/sheet1.xml', 'FFFF0000')

    expect(colorOf(pkg)).toBe('FFFF0000')
    expect(getPartText(pkg, 'xl/worksheets/sheet1.xml')?.match(/<tabColor/gu)).toHaveLength(1)
  })

  it('takes it off again, and the element with it', () => {
    const pkg = made()
    setTabColor(pkg, 'xl/worksheets/sheet1.xml', 'FF00FF00')
    setTabColor(pkg, 'xl/worksheets/sheet1.xml', null)

    expect(getPartText(pkg, 'xl/worksheets/sheet1.xml')).not.toContain('sheetPr')
  })
})

describe('a name nothing else is using', () => {
  it('is the one asked for where it is free', () => {
    expect(freeName(['One'], 'Two')).toBe('Two')
  })

  it('counts up until it is', () => {
    expect(freeName(['Sheet', 'Sheet (2)'], 'Sheet')).toBe('Sheet (3)')
  })

  it('does not care about case, because Excel does not', () => {
    expect(freeName(['sheet'], 'Sheet')).toBe('Sheet (2)')
  })
})
