import { compareXml, describeDifferences } from '@orangery/ooxml-core'
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

/**
 * What a `<col>` says that this does not model.
 *
 * Two bugs with one cause — a writer stating only what the model holds.
 * `style` on a column is the format every cell in it inherits, and it was read
 * only when the run also said `customFormat`, which is a row's attribute and
 * which Excel does not write on a column: the style of every column Excel ever
 * wrote was being dropped. `bestFit` is not modelled at all and is carried.
 *
 * 251 files of the full corpus.
 *
 * https://github.com/HutsuliakDmytro/orangery/issues/3
 */
describe('a column with more on it than we model', () => {
  const sheet = (cols: string) =>
    `<worksheet xmlns="x"><cols>${cols}</cols><sheetData/></worksheet>`

  it('reads the style of a column that does not say customFormat', () => {
    const read = readWorksheet(sheet('<col min="1" max="3" width="9" style="7"/>'))

    expect(read?.columns[0]?.style).toBe(7)
  })

  it('writes the style back without inventing customFormat', () => {
    const read = readWorksheet(sheet('<col min="1" max="3" width="9" style="7"/>'))
    const written = writeColumns(read?.columns ?? [])

    expect(written).toContain('style="7"')
    expect(written).not.toContain('customFormat')
  })

  it('carries bestFit through a round-trip', () => {
    const source = sheet('<col min="2" max="2" width="12" customWidth="1" bestFit="1"/>')
    const read = readWorksheet(source)

    expect(read?.columns[0]?.carried).toEqual({ bestFit: '1' })
    expect(writeColumns(read?.columns ?? [])).toContain('bestFit="1"')
  })

  it('keeps two runs apart when only what they carry differs', () => {
    const read = readWorksheet(
      sheet('<col min="1" max="1" width="9" bestFit="1"/><col min="2" max="2" width="9"/>'),
    )
    const written = writeColumns(read?.columns ?? [])

    expect(written).toContain('min="1" max="1"')
    expect(written).toContain('min="2" max="2"')
  })

  it('leaves a whole sheet of columns as it found them', () => {
    // Structurally: the writer states the attributes in its own order, which
    // is what `compareXml` exists to ignore and what Excel does not read.
    const source = sheet(
      '<col min="1" max="1" width="18.5" customWidth="1" style="3"/>' +
        '<col min="2" max="4" width="9.140625" bestFit="1" customWidth="1"/>' +
        '<col min="5" max="5" hidden="1" width="0" customWidth="1"/>',
    )
    const read = readWorksheet(source)

    const differences = compareXml(source, replaceColumns(source, read?.columns ?? []))
    expect(describeDifferences(differences)).toBe('no differences')
  })
})
