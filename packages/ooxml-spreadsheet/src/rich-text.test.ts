import { describe, expect, it } from 'vitest'
import { parseXml, tagName } from '@orangery/ooxml-core'
import { readRichText } from './rich-text'
import { readSheetData, writeSheetData } from './sheet-data'
import { cellAt } from './cells'

/**
 * A cell whose words are not all alike.
 *
 * A cell has one style, so a cell cannot be half bold; what can be is the
 * string in it. The two questions are what the pieces say about themselves,
 * and whether a file that holds them comes back unchanged.
 */

const read = (xml: string) => {
  const root = parseXml(xml).find((node) => tagName(node) !== null)
  if (root === undefined) throw new Error('nothing to read')
  return readRichText(root)
}

describe('a string in pieces', () => {
  it('joins the words, whatever they are made of', () => {
    const text = read(
      '<si><r><t xml:space="preserve">Spent </t></r>' + '<r><rPr><b/></rPr><t>so far</t></r></si>',
    )

    expect(text.text).toBe('Spent so far')
    expect(text.runs).toHaveLength(2)
  })

  it('gives each piece only what it says about itself', () => {
    // A run that reddens its words has no opinion about bold, and filling
    // that gap with `false` would straighten every heading it appeared in.
    const text = read('<si><r><rPr><color rgb="FFC00000"/></rPr><t>late</t></r></si>')
    const font = text.runs?.[0]?.font

    expect(font?.color).toEqual({ kind: 'rgb', hex: 'FFC00000' })
    expect(font).not.toHaveProperty('bold')
  })

  it('reads the font a run names, which is not the cell’s', () => {
    const text = read(
      '<si><r><rPr><rFont val="Courier New"/><sz val="9"/></rPr><t>=A1</t></r></si>',
    )

    expect(text.runs?.[0]?.font).toMatchObject({ name: 'Courier New', size: 9 })
  })

  it('has no runs at all where the string is one plain piece', () => {
    // Which is nearly every string in nearly every workbook, and the caller
    // draws it with the cell's own style rather than asking what it was made of.
    const text = read('<si><t>Month</t></si>')

    expect(text.text).toBe('Month')
    expect(text.runs).toBeNull()
  })
})

const INLINE =
  '<worksheet xmlns="x"><sheetData><row r="1">' +
  '<c r="A1" t="inlineStr"><is><r><t xml:space="preserve">Net </t></r>' +
  '<r><rPr><i/></rPr><t>total</t></r></is></c>' +
  '<c r="B1" t="inlineStr"><is><t>Plain</t></is></c>' +
  '</row></sheetData></worksheet>'

describe('a string written inside the cell', () => {
  it('is read with its pieces as well as its words', () => {
    const cell = cellAt(readSheetData(INLINE), { row: 0, column: 0 })

    expect(cell?.value).toBe('Net total')
    expect(cell?.rich?.runs?.[1]?.font).toMatchObject({ italic: true })
  })

  it('leaves a plain one plain, without a tree per text cell', () => {
    expect(cellAt(readSheetData(INLINE), { row: 0, column: 1 })?.rich).toBeNull()
  })

  it('goes back into the file exactly as it came out of it', () => {
    // Rebuilding an `<rPr>` would rebuild only the parts of it this
    // understands, and a phonetic reading would go out with the rest.
    const written = writeSheetData(readSheetData(INLINE))

    expect(written).toContain(
      '<is><r><t xml:space="preserve">Net </t></r><r><rPr><i/></rPr><t>total</t></r></is>',
    )
    expect(written).toContain('<c r="B1" t="inlineStr"><is><t>Plain</t></is></c>')
  })
})
