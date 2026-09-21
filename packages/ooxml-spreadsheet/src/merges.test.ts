import { describe, expect, it } from 'vitest'
import { mergeCovering, replaceMerges, withMerge, withoutMerges, writeMerges } from './merges'
import { parseRange } from './reference'

/**
 * The cells a sheet draws as one.
 *
 * A merge is not a property of a cell — it is a rectangle in a list of its
 * own, and the cells inside it go on existing. Two of them cannot overlap,
 * which is the rule that makes putting one in a matter of taking others out.
 */

const range = (text: string) => {
  const parsed = parseRange(text)
  if (parsed === null) throw new Error(`${text} is not a range`)
  return parsed
}

describe('putting a merge in', () => {
  it('adds the rectangle', () => {
    const after = withMerge([], range('B2:D4'))

    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ from: { row: 1, column: 1 }, to: { row: 3, column: 3 } })
  })

  it('takes out whatever it lands on, because two cannot overlap', () => {
    // A file where they do is one Excel refuses.
    const after = withMerge([range('A1:B2')], range('B2:C3'))

    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ from: { row: 1, column: 1 } })
  })

  it('leaves the merges it does not touch', () => {
    const after = withMerge([range('A1:A2')], range('C1:D1'))
    expect(after).toHaveLength(2)
  })

  it('merges nothing for a range of one cell', () => {
    // Which is what asking to unmerge a single cell means; a merge of one is
    // something Excel writes and every other reader ignores.
    expect(withMerge([range('A1:B2')], range('A1'))).toHaveLength(0)
  })

  it('reads a range written backwards the same way', () => {
    const after = withMerge([], range('D4:B2'))
    expect(after[0]).toMatchObject({ from: { row: 1, column: 1 }, to: { row: 3, column: 3 } })
  })
})

describe('taking merges out', () => {
  it('removes every one a range touches', () => {
    const merges = [range('A1:B2'), range('D1:E2'), range('A5:B6')]
    expect(withoutMerges(merges, range('A1:E1'))).toHaveLength(1)
  })

  it('leaves the list alone where nothing is touched', () => {
    const merges = [range('A1:B2')]
    expect(withoutMerges(merges, range('D4:E5'))).toEqual(merges)
  })
})

describe('which merge a cell is in', () => {
  it('is the one covering it, or none', () => {
    const merges = [range('B2:D4')]

    expect(mergeCovering(merges, { row: 2, column: 2 })).not.toBeNull()
    expect(mergeCovering(merges, { row: 1, column: 1 })).not.toBeNull()
    expect(mergeCovering(merges, { row: 0, column: 0 })).toBeNull()
  })
})

describe('writing them back', () => {
  it('counts them, and names them as the file does', () => {
    expect(writeMerges([range('B1:C1')])).toBe(
      '<mergeCells count="1"><mergeCell ref="B1:C1"/></mergeCells>',
    )
  })

  it('is nothing at all for a sheet with none', () => {
    expect(writeMerges([])).toBe('')
  })

  it('replaces the element that was there', () => {
    const sheet =
      '<worksheet xmlns="x"><sheetData/><mergeCells count="1">' +
      '<mergeCell ref="A1:B1"/></mergeCells></worksheet>'
    const after = replaceMerges(sheet, [range('C1:D1')])

    expect(after).toContain('ref="C1:D1"')
    expect(after).not.toContain('ref="A1:B1"')
  })

  it('puts a new one after the cells, where the schema wants it', () => {
    // A `mergeCells` before the cells is a file Excel offers to repair.
    const sheet = '<worksheet xmlns="x"><sheetData><row r="1"/></sheetData></worksheet>'
    const after = replaceMerges(sheet, [range('A1:B1')])

    expect(after.indexOf('<mergeCells')).toBeGreaterThan(after.indexOf('</sheetData>'))
  })

  it('takes the element away when the last merge goes', () => {
    const sheet =
      '<worksheet xmlns="x"><sheetData/><mergeCells count="1">' +
      '<mergeCell ref="A1:B1"/></mergeCells></worksheet>'

    expect(replaceMerges(sheet, [])).not.toContain('mergeCells')
  })
})
