import { describe, expect, it } from 'vitest'
import { formatValue } from './format'

/**
 * The table this package is judged by.
 *
 * Every row is a value, a format code and what Excel shows for the two of
 * them. Not what we think is reasonable — what the program the file came from
 * puts on screen, because a format is right when the cell looks like it looked
 * before we opened it.
 *
 * Rows are grouped by what they are about rather than by code, so a gap in the
 * coverage is visible as a group nobody wrote. Where a case is known to be
 * unsettled it is left out rather than guessed at: the corpus of real
 * workbooks (`tests/fixtures/office`) is what will settle those, and a row
 * invented here would look like evidence while being an opinion.
 */

type Row = [value: number | string, code: string, expected: string]

const rows = (name: string, entries: readonly Row[]) => {
  describe(name, () => {
    it.each(entries)('%s through %s is %s', (value, code, expected) => {
      expect(formatValue(value, code).text).toBe(expected)
    })
  })
}

rows('whole numbers', [
  [0, '0', '0'],
  [1, '0', '1'],
  [-1, '0', '-1'],
  [1234, '0', '1234'],
  [1234, '#,##0', '1,234'],
  [1234, '#,###', '1,234'],
  [0, '#', ''],
  [0, '#,##0', '0'],
  [1_000_000, '#,##0', '1,000,000'],
  [-1234, '#,##0', '-1,234'],
])

rows('decimal places', [
  [1.5, '0', '2'],
  [1.4, '0', '1'],
  [2.5, '0', '3'],
  [-2.5, '0', '-3'],
  [1.5, '0.0', '1.5'],
  [1.25, '0.0', '1.3'],
  [1.005, '0.00', '1.01'],
  [0.5, '0.00', '0.50'],
  [0.5, '#.##', '.5'],
  [0.5, '0.##', '0.5'],
  [123.456, '0.00', '123.46'],
  [123.456, '#,##0.0', '123.5'],
])

rows('percentages', [
  [0, '0%', '0%'],
  [0.15, '0%', '15%'],
  [0.155, '0%', '16%'],
  [0.155, '0.0%', '15.5%'],
  [1, '0%', '100%'],
  [-0.05, '0.0%', '-5.0%'],
  [12, '0%', '1200%'],
])

rows('scaling by thousands', [
  [1234, '#,##0,', '1'],
  [1500, '#,##0,', '2'],
  [1_234_567, '#,##0,', '1,235'],
  [1_234_567, '0.0,', '1234.6'],
  [1_234_567_890, '#,##0,,', '1,235'],
])

rows('sections', [
  [5, '0;-0', '5'],
  [-5, '0;-0', '-5'],
  [-5, '0;(0)', '(5)'],
  [0, '0;-0;"zero"', 'zero'],
  [5, '0;-0;"zero"', '5'],
  [-5, '0;-0;"zero"', '-5'],
  [1234.5, '#,##0.00;[Red]-#,##0.00', '1,234.50'],
  [-1234.5, '#,##0.00;[Red]-#,##0.00', '-1,234.50'],
])

rows('conditions', [
  [150, '[>=100]"high";[<=10]"low";0', 'high'],
  [5, '[>=100]"high";[<=10]"low";0', 'low'],
  [50, '[>=100]"high";[<=10]"low";0', '50'],
  [0, '[=0]"nil";0', 'nil'],
])

rows('words beside numbers', [
  [5, '0" kg"', '5 kg'],
  [5, '"about "0', 'about 5'],
  [5, '0\\%', '5%'],
  [1234.5, '[$€-407]#,##0.00', '€1,234.50'],
  [1234.5, '#,##0.00" €"', '1,234.50 €'],
])

rows('text', [
  ['hello', '@', 'hello'],
  ['hello', '@" there"', 'hello there'],
  ['hello', '"["@"]"', '[hello]'],
  ['hello', '0.00', 'hello'],
])

// 45292 is the 1st of January 2024, a Monday; .5 is noon and .75 is six in
// the evening.
rows('dates', [
  [45_292, 'yyyy-mm-dd', '2024-01-01'],
  [45_292, 'dd/mm/yyyy', '01/01/2024'],
  [45_292, 'd/m/yy', '1/1/24'],
  [45_292, 'd mmm yyyy', '1 Jan 2024'],
  [45_292, 'mmmm d, yyyy', 'January 1, 2024'],
  [45_292, 'mmmmm', 'J'],
  [45_292, 'ddd', 'Mon'],
  [45_292, 'dddd, d mmmm', 'Monday, 1 January'],
  [45_292, 'mm-dd-yy', '01-01-24'],
  [45_658, 'yyyy', '2025'],
  [1, 'yyyy-mm-dd', '1900-01-01'],
  [60, 'yyyy-mm-dd', '1900-02-29'],
  [61, 'yyyy-mm-dd', '1900-03-01'],
])

rows('times', [
  [45_292.5, 'h:mm', '12:00'],
  [45_292.75, 'h:mm', '18:00'],
  [45_292.75, 'h:mm AM/PM', '6:00 PM'],
  [45_292.25, 'hh:mm AM/PM', '06:00 AM'],
  [45_292.5, 'h:mm:ss', '12:00:00'],
  [45_292, 'h:mm', '0:00'],
  [0.5, 'h:mm', '12:00'],
  [45_292.5, 'yyyy-mm-dd h:mm', '2024-01-01 12:00'],
])

rows('elapsed time, which does not wrap', [
  [1.5, '[h]:mm', '36:00'],
  [0.5, '[h]:mm', '12:00'],
  [1.5, '[mm]', '2160'],
  [2, '[h]', '48'],
])

rows('fractions', [
  [1.25, '# ?/?', '1 1/4'],
  [1.5, '# ?/?', '1 1/2'],
  [2.75, '# ?/?', '2 3/4'],
  [1.3333, '# ??/??', '1 1/3'],
  [0.3125, '# ?/16', '5/16'],
  [3, '# ?/?', '3'],
])

rows('scientific notation', [
  [1234.5, '0.00E+00', '1.23E+03'],
  [0.00012, '0.00E+00', '1.20E-04'],
  [1, '0.00E+00', '1.00E+00'],
  [-1234.5, '0.00E+00', '-1.23E+03'],
  [1e100, '0E+000', '1E+100'],
])

rows('General, which every new cell has', [
  [0, 'General', '0'],
  [1, 'General', '1'],
  [1.5, 'General', '1.5'],
  [-1.5, 'General', '-1.5'],
  [1234.5678, 'General', '1234.5678'],
  ['text', 'General', 'text'],
])
