import { describe, expect, it } from 'vitest'
import { isTwelveHour, parseFormat } from './parse'
import type { Token } from './parse'

/**
 * A format code, taken apart.
 *
 * The tests that matter here are the ambiguous ones: the same letter means
 * different things in different places, and every one of those is a cell that
 * shows the wrong thing with nothing to say why.
 */

const kindsOf = (code: string) => parseFormat(code).sections.map((section) => section.kind)
const tokensOf = (code: string, at = 0): Token[] => parseFormat(code).sections[at]?.tokens ?? []

describe('sections', () => {
  it('splits a code into what it says about each kind of value', () => {
    // Positive, negative, zero, text.
    const format = parseFormat('#,##0.00;[Red](#,##0.00);"—";@')

    expect(format.sections).toHaveLength(4)
    expect(format.sections[1]?.color).toBe('Red')
    expect(format.sections[3]?.kind).toBe('text')
  })

  it('does not split on a semicolon inside quotes', () => {
    expect(parseFormat('"a;b"0').sections).toHaveLength(1)
  })

  it('reads the condition a section is for', () => {
    const format = parseFormat('[>=100]#,##0;[<0]-#,##0;0')

    expect(format.sections[0]?.condition).toEqual({ operator: '>=', value: 100 })
    expect(format.sections[1]?.condition).toEqual({ operator: '<', value: 0 })
    expect(format.sections[2]?.condition).toBeNull()
  })

  it('reads a colour by name and by number', () => {
    expect(parseFormat('[Blue]0').sections[0]?.color).toBe('Blue')
    expect(parseFormat('[Color 12]0').sections[0]?.color).toBe('Color 12')
  })
})

describe('what kind of section it is', () => {
  it('knows a date by its letters', () => {
    expect(kindsOf('yyyy-mm-dd')).toEqual(['date'])
    expect(kindsOf('h:mm:ss')).toEqual(['date'])
  })

  it('knows a number that merely talks about time', () => {
    // `0 "months"` is a number, however much it says about months.
    expect(kindsOf('0 "months"')).toEqual(['number'])
    expect(kindsOf('#,##0.00')).toEqual(['number'])
  })

  it('knows an elapsed unit even with nothing else beside it', () => {
    expect(kindsOf('[h]:mm')).toEqual(['date'])
  })

  it('knows a text section by its placeholder', () => {
    expect(kindsOf('@')).toEqual(['text'])
    expect(kindsOf('"Total: "@')).toEqual(['text'])
  })
})

describe('the ambiguous letters', () => {
  it('reads a run of the same letter as one token', () => {
    // `yyyy` is a year, not four of them.
    const tokens = tokensOf('yyyy-mm-dd')

    expect(tokens.filter((token) => token.kind === 'date').map((token) => token.code)).toEqual([
      'yyyy',
      'mm',
      'dd',
    ])
  })

  it('keeps the stroke of a date as a stroke', () => {
    // `/` divides in `# ?/?` and separates in `d/m/yyyy`.
    const tokens = tokensOf('d/m/yyyy')

    expect(tokens.some((token) => token.kind === 'fraction')).toBe(false)
    expect(tokens.filter((token) => token.kind === 'literal').map((one) => one.text)).toEqual([
      '/',
      '/',
    ])
  })

  it('reads the stroke of a fraction as division', () => {
    expect(tokensOf('# ?/?').some((token) => token.kind === 'fraction')).toBe(true)
  })

  it('sees the marker that makes a clock twelve-hour', () => {
    const format = parseFormat('h:mm AM/PM')
    const section = format.sections[0]

    expect(section === undefined ? false : isTwelveHour(section)).toBe(true)
    expect(isTwelveHour(parseFormat('h:mm').sections[0] ?? ({ tokens: [] } as never))).toBe(false)
  })

  it('reads an elapsed unit as its own token', () => {
    const tokens = tokensOf('[h]:mm:ss')

    expect(tokens[0]).toEqual({ kind: 'elapsed', code: 'h' })
    expect(tokens.filter((token) => token.kind === 'date').map((one) => one.code)).toEqual([
      'mm',
      'ss',
    ])
  })
})

describe('the punctuation that does arithmetic', () => {
  it('tells grouping commas from scaling ones', () => {
    // `#,##0,` shows thousands: the comma between digits groups, the one after
    // them divides.
    const thousands = tokensOf('#,##0,')

    expect(thousands.filter((token) => token.kind === 'group')).toHaveLength(1)
    expect(thousands.find((token) => token.kind === 'scale')?.by).toBe(1000)
  })

  it('counts every trailing comma, so two of them are millions', () => {
    expect(tokensOf('0,,').find((token) => token.kind === 'scale')?.by).toBe(1_000_000)
  })

  it('reads a percent, which multiplies as well as prints', () => {
    expect(tokensOf('0.0%').some((token) => token.kind === 'percent')).toBe(true)
  })

  it('reads the exponent of a scientific format', () => {
    expect(tokensOf('0.00E+00').find((token) => token.kind === 'exponent')?.sign).toBe('+')
  })
})

describe('literals', () => {
  it('reads a quoted run as itself', () => {
    expect(tokensOf('0" units"').at(-1)).toEqual({ kind: 'literal', text: ' units' })
  })

  it('reads an escaped character as itself', () => {
    expect(tokensOf('0\\%').at(-1)).toEqual({ kind: 'literal', text: '%' })
  })

  it('reads the space that lines columns up', () => {
    expect(tokensOf('0_)').at(-1)).toEqual({ kind: 'pad', char: ')' })
  })

  it('reads the character that fills the rest of the cell', () => {
    expect(tokensOf('0*-').at(-1)).toEqual({ kind: 'fill', char: '-' })
  })

  it('reads a currency, dropping the locale beside it', () => {
    // `[$€-407]` says euros in German; the symbol is text and the locale is
    // about month names, which this does not translate.
    expect(tokensOf('[$€-407]#,##0.00')[0]).toEqual({ kind: 'literal', text: '€' })
  })

  it('drops a locale that states nothing else', () => {
    expect(tokensOf('[$-409]0').every((token) => token.kind !== 'literal')).toBe(true)
  })
})
