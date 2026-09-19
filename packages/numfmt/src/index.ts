/**
 * Excel's number formats: what a cell shows for what it holds.
 *
 * A workbook stores 45292 and shows "1 Jan 2024"; it stores 0.15 and shows
 * "15%". The number is the truth and the format is the picture, and this is
 * the picture — the one part of a spreadsheet a person looks at all day and
 * never thinks about until it is wrong.
 */

export { dateToSerial, elapsedOf, serialToDate } from './serial'
export type { DateParts, Elapsed } from './serial'
export { isTwelveHour, parseFormat } from './parse'
export type { Condition, NumberFormat, Section, Token } from './parse'
