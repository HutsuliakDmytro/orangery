import { describe, expect, it } from 'vitest'
import { cycledReference, referencesIn } from './formulas'

/**
 * The references a formula makes, as things rather than as text.
 *
 * Two jobs share the answer: colouring what a formula names while somebody
 * writes it, and moving the dollars on the one under the caret. Both want
 * `A1:B2` to be one thing, which is what a person means by it.
 */

const shown = (text: string) => referencesIn(text).map((one) => text.slice(one.start, one.end))

describe('finding what a formula names', () => {
  it('finds a single cell', () => {
    expect(shown('=A1+1')).toEqual(['A1'])
  })

  it('finds a range as one thing, not two', () => {
    expect(shown('=SUM(A1:B20)')).toEqual(['A1:B20'])
  })

  it('carries the sheet name with it', () => {
    const found = referencesIn("=SUM('My Sheet'!A1:B2)")

    expect(found).toHaveLength(1)
    expect(found[0]?.sheet).toBe('My Sheet')
    expect(found[0]?.to).toEqual({ row: 1, column: 1 })
  })

  it('says when a reference is in another workbook', () => {
    expect(referencesIn('=[1]Sheet1!A1')[0]?.external).toBe(true)
  })

  it('leaves alone what is not a reference', () => {
    // A string that reads like one, a function three letters long, a name.
    expect(shown('=IF(LOG10(A1)>0,"A1 is big",Tax_Rate)')).toEqual(['A1'])
  })

  it('leaves the column names inside a table reference', () => {
    expect(shown('=SUM(Table1[[#Headers],[A1]])')).toEqual([])
  })

  it('finds every one of several', () => {
    expect(shown('=A1+Sheet2!B2+SUM(C1:C9)')).toEqual(['A1', 'Sheet2!B2', 'C1:C9'])
  })
})

describe('moving the dollars on', () => {
  const cycle = (text: string, caret: number) => cycledReference(text, caret)?.text ?? null

  it('goes round the four ways of writing a reference', () => {
    // Excel's F4, in the fingers of everybody who has copied a formula.
    expect(cycle('=A1', 3)).toBe('=$A$1')
    expect(cycle('=$A$1', 5)).toBe('=A$1')
    expect(cycle('=A$1', 4)).toBe('=$A1')
    expect(cycle('=$A1', 4)).toBe('=A1')
  })

  it('pins both ends of a range together', () => {
    // A range half-pinned is something somebody would have typed.
    expect(cycle('=SUM(A1:B2)', 8)).toBe('=SUM($A$1:$B$2)')
  })

  it('works from the caret at either edge of the reference', () => {
    expect(cycle('=A1+1', 1)).toBe('=$A$1+1')
    expect(cycle('=A1+1', 3)).toBe('=$A$1+1')
  })

  it('keeps the sheet name where it is', () => {
    expect(cycle("='My Sheet'!A1", 13)).toBe("='My Sheet'!$A$1")
  })

  it('leaves the caret after what it changed', () => {
    const after = cycledReference('=A1+B2', 3)

    expect(after?.text).toBe('=$A$1+B2')
    expect(after?.caret).toBe(5)
  })

  it('changes only the reference the caret is in', () => {
    expect(cycle('=A1+B2', 6)).toBe('=A1+$B$2')
  })

  it('says no when the caret is not in a reference', () => {
    expect(cycledReference('=SUM(1,2)', 6)).toBeNull()
    expect(cycledReference('', 0)).toBeNull()
  })
})
