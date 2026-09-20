import { describe, expect, it } from 'vitest'
import { replaceColumns, widthOfColumnIn, withColumns, writeColumns } from './columns'
import { readWorksheet } from './worksheet'

/**
 * The runs a worksheet keeps its columns in.
 *
 * Everything here is about splitting and joining, because that is the whole
 * of what makes this harder than it looks: a sheet says "every column is
 * eight and a half characters" in one element, and widening column C has to
 * cut that element into three without changing what it said about the other
 * sixteen thousand.
 */

const SHEET =
  '<worksheet xmlns="x"><sheetPr/><dimension ref="A1:F40"/>' +
  '<cols><col min="1" max="1" width="20" customWidth="1"/>' +
  '<col min="3" max="5" hidden="1" width="0"/></cols>' +
  '<sheetData/></worksheet>'

const columns = () => {
  const read = readWorksheet(SHEET)
  if (read === null) throw new Error('the part holds no worksheet')
  return read.columns
}

describe('changing what a run says', () => {
  it('leaves the columns outside the span alone', () => {
    const after = withColumns(columns(), 2, 2, { width: 30 })

    expect(widthOfColumnIn(after, 0)).toBe(20)
    expect(widthOfColumnIn(after, 2)).toBe(30)
  })

  it('cuts a run into pieces when the middle of it changes', () => {
    // C to E were one hidden run; widening D makes three, all still hidden.
    const before = columns().filter((range) => range.hidden)
    const after = withColumns(columns(), 3, 3, { width: 30 })

    expect(before).toHaveLength(1)
    expect(after.filter((range) => range.hidden)).toHaveLength(3)
    expect(widthOfColumnIn(after, 3)).toBe(30)
  })

  it('keeps what the run said about everything else', () => {
    // Making a hidden column wider does not unhide it.
    const after = withColumns(columns(), 3, 3, { width: 30 })
    expect(after.find((range) => range.from === 3)?.hidden).toBe(true)
  })

  it('joins runs that end up alike', () => {
    // Give A the same width as B to E and the whole lot is one run.
    const wide = withColumns(columns(), 0, 4, { width: 12, hidden: false, custom: true })

    expect(wide).toHaveLength(1)
    expect(wide[0]).toMatchObject({ from: 0, to: 4, width: 12 })
  })

  it('does not join runs that merely look alike across a gap', () => {
    // A and C are both twelve; B is not, and a file that said A to C were one
    // run would be claiming a width for B.
    const split = withColumns(withColumns(columns(), 0, 0, { width: 12 }), 2, 2, {
      width: 12,
      hidden: false,
    })

    expect(split.filter((range) => range.width === 12)).toHaveLength(2)
  })

  it('makes a run for a span nothing covered', () => {
    const after = withColumns(columns(), 9, 10, { width: 40 })
    expect(after.find((range) => range.from === 9)).toMatchObject({ to: 10, width: 40 })
  })

  it('drops a run that ends up saying nothing', () => {
    // Unhiding C to E and clearing their width leaves nothing to write down.
    const after = withColumns(columns(), 2, 4, {
      hidden: false,
      width: null,
      custom: false,
    })

    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ from: 0, to: 0 })
  })
})

describe('writing the runs back', () => {
  it('counts the columns from one, as the file does', () => {
    expect(writeColumns(columns())).toContain('<col min="1" max="1" width="20"')
  })

  it('says a width is a choice rather than an inheritance', () => {
    // Without `customWidth` Excel treats the number as a hint and recomputes.
    expect(writeColumns(withColumns([], 1, 1, { width: 30 }))).toContain('customWidth="1"')
  })

  it('is nothing at all for a sheet with nothing to say', () => {
    expect(writeColumns([])).toBe('')
  })

  it('replaces the element that was there', () => {
    const after = replaceColumns(SHEET, withColumns(columns(), 0, 0, { width: 44 }))

    expect(after).toContain('width="44"')
    expect(after).not.toContain('width="20"')
    expect([...after.matchAll(/<cols>/gu)]).toHaveLength(1)
  })

  it('puts a new one where the schema wants it, before the cells', () => {
    const bare = '<worksheet xmlns="x"><dimension ref="A1:A1"/><sheetData/></worksheet>'
    const after = replaceColumns(bare, withColumns([], 0, 0, { width: 44 }))

    expect(after.indexOf('<cols>')).toBeLessThan(after.indexOf('<sheetData'))
  })

  it('leaves a part alone when there is nothing to put in it', () => {
    const bare = '<worksheet xmlns="x"><sheetData/></worksheet>'
    expect(replaceColumns(bare, [])).toBe(bare)
  })

  it('takes the element away when the last run goes', () => {
    expect(replaceColumns(SHEET, [])).not.toContain('<cols>')
  })
})
