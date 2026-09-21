import { describe, expect, it } from 'vitest'
import { chosen, shape, suggest } from './suggest'
import type { KnownFunction } from './suggest'

/**
 * What to offer somebody halfway through typing a formula.
 *
 * The interesting half is what is *not* offered: a word in a cell that is
 * not a formula, a column letter, the second half of a reference. A list
 * that popped up over every cell somebody typed a word into would be a list
 * people turn off.
 */

const functions: KnownFunction[] = [
  { name: 'SUM', least: 1, most: null, volatile: false },
  { name: 'SUMIF', least: 2, most: 3, volatile: false },
  { name: 'SUMIFS', least: 3, most: null, volatile: false },
  { name: 'SUBTOTAL', least: 2, most: null, volatile: false },
  { name: 'NOW', least: 0, most: 0, volatile: true },
  { name: 'VLOOKUP', least: 3, most: 4, volatile: false },
  { name: 'ABS', least: 1, most: 1, volatile: false },
]

const at = (text: string, caret = text.length) => suggest(text, caret, functions)

describe('what is offered while a formula is being typed', () => {
  it('offers the functions a half-typed name could become', () => {
    expect(at('=SUM')?.matches.map((one) => one.name)).toEqual(['SUM', 'SUMIF', 'SUMIFS'])
    expect(at('=1+SUB')?.matches.map((one) => one.name)).toEqual(['SUBTOTAL'])
  })

  it('reads the word under the caret rather than the end of the line', () => {
    const found = suggest('=SUM(A1)+VLO', 4, functions)
    expect(found?.word).toBe('SUM')
    expect(found?.from).toBe(1)
  })

  it('offers nothing in a cell that is not a formula', () => {
    // `Northampton` typed into a cell is a place, not a half-written `NOW`.
    expect(at('Northampton')).toBeNull()
    expect(at('SUM')).toBeNull()
  })

  it('offers nothing where a name could not go', () => {
    // The column half of a reference somebody is typing, and a word running
    // on from one.
    expect(at('=A1S')).toBeNull()
    expect(at('=1')).toBeNull()
    expect(at('=')).toBeNull()
  })

  it('offers nothing for a word nothing matches', () => {
    expect(at('=ZZZ')).toBeNull()
  })

  it('minds no case, because a formula does not', () => {
    expect(at('=sum')?.matches.map((one) => one.name)).toEqual(['SUM', 'SUMIF', 'SUMIFS'])
  })
})

describe('choosing one', () => {
  it('puts the name in with its bracket and the caret inside it', () => {
    const found = at('=SUM')
    if (found === null) throw new Error('nothing was offered')

    expect(chosen('=SUM', found, 'SUMIF')).toEqual({ text: '=SUMIF(', caret: 7 })
  })

  it('does not add a second bracket to a formula that has one', () => {
    // Somebody editing `=SU(A1:A9)` into `=SUM(A1:A9)` is finishing a
    // formula rather than starting one.
    const found = suggest('=SU(A1:A9)', 3, functions)
    if (found === null) throw new Error('nothing was offered')

    expect(chosen('=SU(A1:A9)', found, 'SUM')).toEqual({ text: '=SUM(A1:A9)', caret: 4 })
  })

  it('keeps what comes after the word', () => {
    const found = suggest('=SUM+1', 4, functions)
    if (found === null) throw new Error('nothing was offered')

    expect(chosen('=SUM+1', found, 'SUM').text).toBe('=SUM(+1')
  })
})

describe('how many arguments it wants', () => {
  it('says so in words rather than in a count nobody can read', () => {
    expect(shape(functions[5] as KnownFunction)).toBe('3 to 4 arguments')
    expect(shape(functions[0] as KnownFunction)).toBe('1 or more arguments')
    expect(shape(functions[4] as KnownFunction)).toBe('no arguments')
    expect(shape(functions[6] as KnownFunction)).toBe('1 argument')
  })
})
