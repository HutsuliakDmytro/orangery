import { describe, expect, it } from 'vitest'
import { explanationOf, isError } from './trace'

/**
 * What an error value means, said in a sentence.
 *
 * The strings are Excel's nine, and the sentences are what its own menu says
 * two clicks away — said shorter, and about the cause rather than the name.
 */

describe('explaining an error', () => {
  it('knows the nine a spreadsheet has', () => {
    for (const error of [
      '#DIV/0!',
      '#VALUE!',
      '#REF!',
      '#NAME?',
      '#NUM!',
      '#N/A',
      '#NULL!',
      '#SPILL!',
      '#CALC!',
    ]) {
      expect(explanationOf(error)).not.toBeNull()
    }
  })

  it('says what caused it rather than what it is called', () => {
    // Somebody reading `#DIV/0!` already knows it says `#DIV/0!`.
    expect(explanationOf('#DIV/0!')).toContain('nought')
    expect(explanationOf('#NAME?')).toContain('name')
  })

  it('is not put off by the case it arrives in', () => {
    expect(explanationOf('#n/a')).toBe(explanationOf('#N/A'))
  })

  it('has nothing to say about a number', () => {
    expect(explanationOf('42')).toBeNull()
    expect(explanationOf('')).toBeNull()
  })

  it('treats #N/A as an answer rather than a fault, because often it is', () => {
    expect(explanationOf('#N/A')).toContain('rather than a fault')
  })
})

describe('telling an error from a value', () => {
  it('says yes to the ones a formula can come to', () => {
    expect(isError('#REF!')).toBe(true)
    expect(isError('#spill!')).toBe(true)
  })

  it('says no to everything else, blanks included', () => {
    expect(isError('0')).toBe(false)
    expect(isError('#hashtag')).toBe(false)
    expect(isError(null)).toBe(false)
  })
})
