import { describe, expect, it } from 'vitest'
import { filledWith, seriesOf } from './series'

/**
 * What comes after what.
 *
 * The fill handle is the one gesture in a spreadsheet that guesses, so what
 * is tested here is the guess: that it is the obvious one, and that where
 * there is no obvious one the values are copied rather than invented.
 */

const filled = (source: string[], count: number, backwards = false) =>
  filledWith(seriesOf(source), source, count, backwards)

describe('numbers', () => {
  it('counts on by one from a single number', () => {
    expect(filled(['1'], 3)).toEqual(['2', '3', '4'])
  })

  it('takes the step from two of them', () => {
    expect(filled(['5', '10'], 3)).toEqual(['15', '20', '25'])
  })

  it('counts down where the values do', () => {
    expect(filled(['10', '8'], 2)).toEqual(['6', '4'])
  })

  it('copies where the steps do not agree', () => {
    // 1, 2, 4 could be doubling or could be nothing; guessing either is worse
    // than repeating what is there.
    expect(filled(['1', '2', '4'], 3)).toEqual(['1', '2', '4'])
  })

  it('keeps a fraction a fraction', () => {
    expect(filled(['0.5', '1'], 2)).toEqual(['1.5', '2'])
  })
})

describe('names from a list', () => {
  it('goes on with the days of the week', () => {
    expect(filled(['Monday'], 2)).toEqual(['Tuesday', 'Wednesday'])
  })

  it('reads a short name as the name', () => {
    // A column holding `Mon` is one somebody typed by hand.
    expect(filled(['Mon', 'Tue'], 1)).toEqual(['Wednesday'])
  })

  it('wraps round the end of the list', () => {
    // A week dragged for a fortnight is two weeks.
    expect(filled(['Saturday'], 2)).toEqual(['Sunday', 'Monday'])
  })

  it('goes on with the months', () => {
    expect(filled(['January', 'February'], 2)).toEqual(['March', 'April'])
  })

  it('takes a step of more than one', () => {
    expect(filled(['January', 'March'], 2)).toEqual(['May', 'July'])
  })
})

describe('a word with a number on the end', () => {
  it('counts the number and leaves the word', () => {
    expect(filled(['Item 1'], 2)).toEqual(['Item 2', 'Item 3'])
  })

  it('does the same for a quarter', () => {
    expect(filled(['Q1', 'Q2'], 3)).toEqual(['Q3', 'Q4', 'Q5'])
  })

  it('counts the number at the end, where there are two of them', () => {
    // The last one is the one that moves; the rest of the label stands still.
    expect(filled(['row 1 of 12'], 1)).toEqual(['row 1 of 13'])
  })

  it('copies where the words differ', () => {
    expect(filled(['Item 1', 'Thing 2'], 2)).toEqual(['Item 1', 'Thing 2'])
  })
})

describe('anything else', () => {
  it('repeats a single value', () => {
    expect(filled(['Total'], 3)).toEqual(['Total', 'Total', 'Total'])
  })

  it('repeats a block in the order it was in', () => {
    // Dragging three cells down repeats the three, not the last of them.
    expect(filled(['a', 'b', 'c'], 5)).toEqual(['a', 'b', 'c', 'a', 'b'])
  })

  it('has nothing to say about nothing', () => {
    expect(filled(['', ''], 2)).toEqual(['', ''])
  })
})

describe('dragging the other way', () => {
  it('counts backwards from the first value', () => {
    expect(filled(['5', '6'], 2, true)).toEqual(['4', '3'])
  })

  it('walks a list backwards', () => {
    expect(filled(['Wednesday'], 2, true)).toEqual(['Tuesday', 'Monday'])
  })
})
