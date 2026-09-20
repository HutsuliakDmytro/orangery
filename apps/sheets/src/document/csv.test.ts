import { describe, expect, it } from 'vitest'
import { asTyped, decodeCsv, parseCsv, sniffDelimiter, writeCsv } from './csv'

/**
 * Reading and writing the format nobody specified.
 *
 * What is tested here is what a person would notice: an address with a
 * newline in it staying one cell, a German price staying a price, a file from
 * a Ukrainian Excel staying Ukrainian. The separator is guessed, and a guess
 * is only worth having if it is right about the files people have.
 */

describe('cutting a file into fields', () => {
  it('keeps a separator that is inside quotes', () => {
    // Otherwise a column of addresses becomes a column of halves.
    expect(parseCsv('Kyiv,UA\n"Lviv, Halytskyi",UA\n', ',')).toEqual([
      ['Kyiv', 'UA'],
      ['Lviv, Halytskyi', 'UA'],
    ])
  })

  it('keeps a newline that is inside quotes', () => {
    const rows = parseCsv('name,address\nOlha,"1 Main St\nKyiv"\n', ',')

    expect(rows).toHaveLength(2)
    expect(rows[1]?.[1]).toBe('1 Main St\nKyiv')
  })

  it('reads a doubled quote as one quote', () => {
    expect(parseCsv('"she said ""yes"""\n', ',')).toEqual([['she said "yes"']])
  })

  it('does not invent a row after the last newline', () => {
    expect(parseCsv('a,b\nc,d\n', ',')).toHaveLength(2)
  })

  it('takes either line ending, and the old Mac one too', () => {
    expect(parseCsv('a\r\nb\rc', ',')).toEqual([['a'], ['b'], ['c']])
  })

  it('drops the byte-order mark rather than putting it in a cell', () => {
    // A `.csv` written by Excel begins with one, and a first column whose
    // name still carries it is one no formula can find.
    expect(parseCsv('\uFEFFName,Sum\n', ',')).toEqual([['Name', 'Sum']])
  })

  it('keeps an empty field between two separators', () => {
    expect(parseCsv('a,,c\n', ',')).toEqual([['a', '', 'c']])
  })
})

describe('guessing the separator', () => {
  it('picks the semicolon a European export uses', () => {
    expect(sniffDelimiter('name;price\nchair;12,50\ntable;99,00\n')).toBe(';')
  })

  it('picks the tab of something pasted out of a spreadsheet', () => {
    expect(sniffDelimiter('a\tb\tc\n1\t2\t3\n')).toBe('\t')
  })

  it('is not fooled by commas inside prose', () => {
    // Every line has commas in it; only the semicolon cuts them into columns
    // of the same width.
    const text = '"one, two, three";1\n"four, five";2\n"six, seven, eight, nine";3\n'
    expect(sniffDelimiter(text)).toBe(';')
  })

  it('falls back to a comma where there is nothing to count', () => {
    expect(sniffDelimiter('')).toBe(',')
    expect(sniffDelimiter('a single line\n')).toBe(',')
  })
})

describe('writing a file back out', () => {
  it('quotes only what has to be quoted', () => {
    expect(writeCsv([['a', 'b,c']], ',')).toBe('a,"b,c"')
  })

  it('writes a quote twice, which is how it is read back', () => {
    const rows = [['she said "yes"']]
    expect(parseCsv(writeCsv(rows, ','), ',')).toEqual(rows)
  })

  it('survives a round trip with everything awkward in it', () => {
    const rows = [
      ['name', 'note'],
      ['Olha', 'two\nlines'],
      ['Petro', 'a "quote", and a comma'],
      ['', 'blank on the left'],
    ]

    expect(parseCsv(writeCsv(rows, ','), ',')).toEqual(rows)
  })

  it('ends its lines the way Excel does', () => {
    expect(writeCsv([['a'], ['b']], ',')).toBe('a\r\nb')
  })
})

describe('which character is the decimal point', () => {
  it('turns a European number into one this app can read', () => {
    expect(asTyped('12,50', ',')).toBe('12.50')
    expect(asTyped('1.234,50', ',')).toBe('1234.50')
  })

  it('leaves words alone, commas and all', () => {
    expect(asTyped('Lviv, Halytskyi', ',')).toBe('Lviv, Halytskyi')
  })

  it('leaves a date alone', () => {
    // 19.09.2026 is not 19092026.
    expect(asTyped('19.09.2026', ',')).toBe('19.09.2026')
  })

  it('changes nothing at all where the point is a point', () => {
    expect(asTyped('1,234.50', '.')).toBe('1,234.50')
  })
})

describe('what the bytes say', () => {
  it('reads a Ukrainian column written by a Windows Excel', () => {
    // Windows-1251, which is what a `.csv` out of a Ukrainian Excel is, and
    // reading it as UTF-8 gives a column of replacement characters.
    const bytes = new Uint8Array([0xca, 0xe8, 0xbf, 0xe2])
    expect(decodeCsv(bytes, 'windows-1251')).toBe('Київ')
  })

  it('reads the same bytes differently when told they are 1252', () => {
    const bytes = new Uint8Array([0xe4])
    expect(decodeCsv(bytes, 'windows-1252')).toBe('ä')
  })
})
