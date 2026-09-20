import { describe, expect, it } from 'vitest'
import { parseXml, tagName } from '@orangery/ooxml-core'
import {
  rangeCovers,
  readConditionalFormats,
  replaceConditionalFormats,
  writeConditionalFormats,
} from './conditional'

/**
 * The rules, as the file states them.
 *
 * Read without any cell in sight: what a rule says and what it does to a value
 * are two questions, and this is the first one. The defaults get as much
 * attention as the values, because a default read backwards is invisible — an
 * icon set whose numbers all disappear looks like a rendering bug and is a
 * missing `showValue`.
 */

const sheet = (body: string) =>
  readConditionalFormats(
    parseXml(`<worksheet xmlns="x"><sheetData/>${body}</worksheet>`).find(
      (node) => tagName(node) === 'worksheet',
    ) ?? {},
  )

describe('a block of rules', () => {
  it('reads the ranges it covers, which can be several', () => {
    const [block] = sheet(
      '<conditionalFormatting sqref="A1:A10 C2:D4">' +
        '<cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan">' +
        '<formula>100</formula></cfRule></conditionalFormatting>',
    )

    expect(block?.ranges).toHaveLength(2)
    expect(block?.ranges[0]?.to).toEqual({ row: 9, column: 0 })
    expect(block?.ranges[1]?.from).toEqual({ row: 1, column: 2 })
  })

  it('spells a whole column out to the sheet it lives in', () => {
    // `A:A` names no cell, and everything downstream wants four numbers.
    const [block] = sheet(
      '<conditionalFormatting sqref="B:B"><cfRule type="duplicateValues" priority="1"/>' +
        '</conditionalFormatting>',
    )

    expect(block?.ranges[0]?.from).toEqual({ row: 0, column: 1 })
    expect(block?.ranges[0]?.to.row).toBe(1_048_575)
  })

  it('puts the rules in the order they are applied, not the order they are written', () => {
    const [block] = sheet(
      '<conditionalFormatting sqref="A1:A3">' +
        '<cfRule type="cellIs" priority="3" dxfId="2" operator="equal"><formula>3</formula></cfRule>' +
        '<cfRule type="cellIs" priority="1" dxfId="0" operator="equal"><formula>1</formula></cfRule>' +
        '</conditionalFormatting>',
    )

    expect(block?.rules.map((rule) => rule.priority)).toEqual([1, 3])
  })

  it('keeps nothing for a block with no ranges or no rules', () => {
    expect(sheet('<conditionalFormatting sqref="A1:A3"/>')).toHaveLength(0)
  })
})

describe('what a rule says', () => {
  it('reads a comparison with both of its operands', () => {
    const [block] = sheet(
      '<conditionalFormatting sqref="A1:A9"><cfRule type="cellIs" dxfId="4" priority="2" ' +
        'operator="between" stopIfTrue="1"><formula>10</formula><formula>20</formula>' +
        '</cfRule></conditionalFormatting>',
    )
    const rule = block?.rules[0]

    expect(rule?.operator).toBe('between')
    expect(rule?.formulas).toEqual(['10', '20'])
    expect(rule?.dxfId).toBe(4)
    expect(rule?.stopIfTrue).toBe(true)
  })

  it('reads the word a text rule looks for, beside the formula that repeats it', () => {
    const [block] = sheet(
      '<conditionalFormatting sqref="A1:A9"><cfRule type="containsText" dxfId="1" priority="1" ' +
        'operator="containsText" text="done">' +
        '<formula>NOT(ISERROR(SEARCH("done",A1)))</formula></cfRule></conditionalFormatting>',
    )

    expect(block?.rules[0]?.text).toBe('done')
  })

  it('reads a colour scale as stops and colours in step', () => {
    const [block] = sheet(
      '<conditionalFormatting sqref="A1:A9"><cfRule type="colorScale" priority="1"><colorScale>' +
        '<cfvo type="min"/><cfvo type="percentile" val="50"/><cfvo type="max"/>' +
        '<color rgb="FFF8696B"/><color rgb="FFFFEB84"/><color theme="9" tint="-0.25"/>' +
        '</colorScale></cfRule></conditionalFormatting>',
    )
    const scale = block?.rules[0]?.colorScale

    expect(scale?.values.map((one) => one.type)).toEqual(['min', 'percentile', 'max'])
    expect(scale?.values[1]?.value).toBe('50')
    expect(scale?.colors[2]).toEqual({ kind: 'theme', index: 9, tint: -0.25 })
  })

  it('gives a bar the lengths the format defaults to, which are not nought and one', () => {
    // A bar with no floor would make the smallest value look like no rule at
    // all, and Excel never draws one that way.
    const [block] = sheet(
      '<conditionalFormatting sqref="A1:A9"><cfRule type="dataBar" priority="1"><dataBar>' +
        '<cfvo type="min"/><cfvo type="max"/><color rgb="FF638EC6"/>' +
        '</dataBar></cfRule></conditionalFormatting>',
    )
    const bar = block?.rules[0]?.dataBar

    expect(bar?.minLength).toBe(10)
    expect(bar?.maxLength).toBe(90)
    expect(bar?.showValue).toBe(true)
  })

  it('reads an icon set with its thresholds and whether they include the number', () => {
    const [block] = sheet(
      '<conditionalFormatting sqref="A1:A9"><cfRule type="iconSet" priority="1">' +
        '<iconSet iconSet="4Rating" reverse="1" showValue="0">' +
        '<cfvo type="percent" val="0"/><cfvo type="percent" val="25" gte="0"/>' +
        '<cfvo type="percent" val="50"/><cfvo type="percent" val="75"/>' +
        '</iconSet></cfRule></conditionalFormatting>',
    )
    const icons = block?.rules[0]?.iconSet

    expect(icons?.name).toBe('4Rating')
    expect(icons?.reverse).toBe(true)
    expect(icons?.showValue).toBe(false)
    expect(icons?.values.map((one) => one.inclusive)).toEqual([true, false, true, true])
  })

  it('reads the rules about rank and average with their own attributes', () => {
    const [block] = sheet(
      '<conditionalFormatting sqref="A1:A9">' +
        '<cfRule type="top10" dxfId="0" priority="1" percent="1" bottom="1" rank="20"/>' +
        '<cfRule type="aboveAverage" dxfId="1" priority="2" aboveAverage="0" equalAverage="1"/>' +
        '</conditionalFormatting>',
    )

    expect(block?.rules[0]).toMatchObject({ rank: 20, percent: true, bottom: true })
    expect(block?.rules[1]).toMatchObject({ above: false, equalAverage: true })
  })

  it('defaults an unstated rank rule to the top of the range, not the bottom', () => {
    const [block] = sheet(
      '<conditionalFormatting sqref="A1:A9">' +
        '<cfRule type="top10" dxfId="0" priority="1" rank="3"/></conditionalFormatting>',
    )

    expect(block?.rules[0]).toMatchObject({ percent: false, bottom: false })
  })
})

describe('whether a range covers a cell', () => {
  const range = { sheet: null, from: { row: 1, column: 1 }, to: { row: 3, column: 4 } }

  it('says yes inside and on the edges', () => {
    expect(rangeCovers(range, { row: 1, column: 1 })).toBe(true)
    expect(rangeCovers(range, { row: 3, column: 4 })).toBe(true)
    expect(rangeCovers(range, { row: 2, column: 3 })).toBe(true)
  })

  it('says no outside', () => {
    expect(rangeCovers(range, { row: 0, column: 1 })).toBe(false)
    expect(rangeCovers(range, { row: 2, column: 5 })).toBe(false)
  })

  it('reads a range written backwards the same way', () => {
    const backwards = { sheet: null, from: { row: 3, column: 4 }, to: { row: 1, column: 1 } }
    expect(rangeCovers(backwards, { row: 2, column: 2 })).toBe(true)
  })
})

describe('writing the rules back', () => {
  const sheetWith = (inside: string) =>
    `<?xml version="1.0"?><worksheet><sheetData/>${inside}</worksheet>`

  const read = (inside: string) =>
    readConditionalFormats(
      parseXml(sheetWith(inside)).find((node) => tagName(node) === 'worksheet') ?? {},
    )

  it('comes back the same through a round trip', () => {
    const before = read(
      '<conditionalFormatting sqref="B2:B9">' +
        '<cfRule type="cellIs" dxfId="0" priority="1" operator="greaterThan">' +
        '<formula>100</formula></cfRule></conditionalFormatting>',
    )

    expect(read(writeConditionalFormats(before))).toEqual(before)
  })

  it('keeps a colour scale, stops and colours both', () => {
    const before = read(
      '<conditionalFormatting sqref="A1:A9"><cfRule type="colorScale" priority="2"><colorScale>' +
        '<cfvo type="min"/><cfvo type="max"/>' +
        '<color rgb="FFF8696B"/><color theme="4" tint="0.4"/>' +
        '</colorScale></cfRule></conditionalFormatting>',
    )

    expect(read(writeConditionalFormats(before))).toEqual(before)
  })

  it('keeps a rule of a kind nothing here understands', () => {
    // Losing it would be losing somebody's colours.
    const before = read(
      '<conditionalFormatting sqref="A1"><cfRule type="expression" dxfId="3" priority="1">' +
        '<formula>MOD(ROW(),2)=0</formula></cfRule></conditionalFormatting>',
    )

    const again = read(writeConditionalFormats(before))
    expect(again[0]?.rules[0]).toMatchObject({ type: 'expression', dxfId: 3 })
    expect(again[0]?.rules[0]?.formulas).toEqual(['MOD(ROW(),2)=0'])
  })

  it('writes nothing for a sheet with no rules', () => {
    expect(writeConditionalFormats([])).toBe('')
  })

  it('puts them where the schema says they go', () => {
    // After the merges and before the validations: an element out of order
    // is a file Excel offers to repair.
    const sheet = sheetWith('<mergeCells count="0"/><dataValidations count="0"/>')
    const written = replaceConditionalFormats(sheet, '<conditionalFormatting/>')

    expect(written.indexOf('<conditionalFormatting/>')).toBeGreaterThan(
      written.indexOf('<mergeCells'),
    )
    expect(written.indexOf('<conditionalFormatting/>')).toBeLessThan(
      written.indexOf('<dataValidations'),
    )
  })

  it('replaces every block a sheet had, not only the first', () => {
    // They are one list as far as a sheet is concerned.
    const sheet = sheetWith(
      '<conditionalFormatting sqref="A1"><cfRule type="cellIs" priority="1"/></conditionalFormatting>' +
        '<conditionalFormatting sqref="B1"><cfRule type="cellIs" priority="2"/></conditionalFormatting>',
    )

    const written = replaceConditionalFormats(sheet, '<conditionalFormatting sqref="C1"/>')
    expect(written).toContain('sqref="C1"')
    expect(written).not.toContain('sqref="A1"')
    expect(written).not.toContain('sqref="B1"')
  })
})
