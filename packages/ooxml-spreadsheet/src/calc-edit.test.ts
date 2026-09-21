import { describe, expect, it } from 'vitest'
import { getPartText, setPartText } from '@orangery/ooxml-core'
import { replaceCalculationMode, writeCalculationMode } from './calc-edit'
import { readWorkbook } from './workbook'
import { newWorkbook } from './new-workbook'

/**
 * Whether the workbook works itself out as it is typed into, written back.
 *
 * It belongs to the workbook rather than to the program, so it has to survive
 * the file — and the element that holds it says several other things this
 * program has no opinion about, so it is patched rather than rebuilt.
 */

const RELS =
  '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
  '<Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/></Relationships>'

const packageOf = (workbookXml: string) => {
  const pkg = { parts: new Map() }
  setPartText(pkg, 'xl/workbook.xml', workbookXml)
  setPartText(pkg, 'xl/_rels/workbook.xml.rels', RELS)
  return pkg
}

const SHEETS = '<sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>'
const opening = `<workbook xmlns="x" xmlns:r="r">${SHEETS}`

describe('saying how a workbook is worked out', () => {
  it('sets the attribute on the element the file already has', () => {
    const xml = `${opening}<calcPr calcId="191029"/></workbook>`

    expect(replaceCalculationMode(xml, true)).toContain(
      '<calcPr calcId="191029" calcMode="manual"/>',
    )
  })

  it('keeps everything else the element said', () => {
    // `calcId` is the version of Excel that last worked the workbook out, and
    // `fullCalcOnLoad` is a question about this file that this program does
    // not answer. An element rebuilt from the one attribute modelled here
    // would throw both away.
    const xml = `${opening}<calcPr calcId="191029" fullCalcOnLoad="1" iterate="1"/></workbook>`
    const written = replaceCalculationMode(xml, true)

    expect(written).toContain('calcId="191029"')
    expect(written).toContain('fullCalcOnLoad="1"')
    expect(written).toContain('iterate="1"')
  })

  it('writes automatic as no attribute at all, which is what a workbook without one says', () => {
    const xml = `${opening}<calcPr calcId="191029" calcMode="manual"/></workbook>`

    expect(replaceCalculationMode(xml, false)).toContain('<calcPr calcId="191029"/>')
  })

  it('leaves a workbook that never said anything alone when it is automatic', () => {
    const xml = `${opening}</workbook>`

    expect(replaceCalculationMode(xml, false)).toBe(xml)
  })

  it('adds the element to a workbook that has none, where the schema puts it', () => {
    const xml = `${opening}<definedNames><definedName name="Rates">Sheet1!$A$1</definedName></definedNames><extLst/></workbook>`
    const written = replaceCalculationMode(xml, true)

    // After the names and before what follows them: an element out of order
    // is a file Excel offers to repair.
    expect(written).toContain('</definedNames><calcPr calcMode="manual"/><extLst/>')
  })

  it('puts it after the sheets when there is nothing else to go after', () => {
    expect(replaceCalculationMode(`${opening}</workbook>`, true)).toBe(
      `${opening}<calcPr calcMode="manual"/></workbook>`,
    )
  })

  it('handles the element written as a pair of tags rather than one', () => {
    const xml = `${opening}<calcPr calcId="1"></calcPr></workbook>`

    expect(replaceCalculationMode(xml, true)).toContain('<calcPr calcId="1" calcMode="manual">')
  })

  it('comes back from the file as what was written', () => {
    const pkg = packageOf(`${opening}<calcPr calcId="191029"/></workbook>`)

    expect(writeCalculationMode(pkg, true)).toBe(true)
    expect(readWorkbook(pkg)?.manualCalculation).toBe(true)

    writeCalculationMode(pkg, false)
    expect(readWorkbook(pkg)?.manualCalculation).toBe(false)
  })

  it('says so when there is no workbook part to write into', () => {
    expect(writeCalculationMode({ parts: new Map() }, true)).toBe(false)
  })

  it('writes into a workbook this program made itself', () => {
    const pkg = newWorkbook([{ name: 'Sheet1', rows: [[1]] }])

    expect(writeCalculationMode(pkg, true)).toBe(true)
    expect(getPartText(pkg, 'xl/workbook.xml')).toContain('calcMode="manual"')
    expect(readWorkbook(pkg)?.manualCalculation).toBe(true)
  })
})
