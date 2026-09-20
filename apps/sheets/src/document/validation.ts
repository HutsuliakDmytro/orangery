import { parseRange, validationAt } from '@orangery/ooxml-spreadsheet'
import type { DataValidation } from '@orangery/ooxml-spreadsheet'
import { parseInput } from '@orangery/numfmt'
import type { CellAddress } from '@orangery/grid'
import { shownText } from './shown'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * What a cell is allowed to hold, and whether what somebody typed is.
 *
 * A validation rule belongs to the sheet rather than to the cell, so emptying
 * a cell leaves the rule where it was — which is what makes a column of
 * dropdowns survive somebody clearing it.
 *
 * One kind of rule is deliberately not judged: `custom`, whose condition is a
 * formula. Working it out means asking the engine, and the engine answers a
 * moment later while this has to answer now. A rule this program cannot judge
 * is a rule it lets through rather than a rule it invents an answer for.
 */

/** The rule covering a cell, or null — which is most cells. */
export function ruleAt(sheet: OpenSheet, cell: CellAddress): DataValidation | null {
  return validationAt(sheet.sheet.validations, cell)
}

/**
 * The values a list rule allows, in the order it states them.
 *
 * Two shapes: a list typed into the rule — `"North,South,East"` — or a range
 * of the workbook. The second is what people use for a list they can edit,
 * and the reason a dropdown can change without anybody opening a dialog.
 */
export function choicesOf(open: OpenWorkbook, sheet: OpenSheet, rule: DataValidation): string[] {
  const written = rule.formula1?.trim() ?? ''
  if (rule.kind !== 'list' || written === '') return []

  const quoted = written.startsWith('"') && written.endsWith('"')
  if (quoted) {
    return written
      .slice(1, -1)
      .split(',')
      .map((one) => one.trim())
      .filter((one) => one !== '')
  }

  const range = parseRange(written)
  if (range === null) return []

  // A range on another sheet is named in the formula; one with no name is on
  // the sheet the rule is on.
  const named = written.includes('!') ? written.slice(0, written.lastIndexOf('!')) : null
  const from =
    named === null
      ? sheet
      : (open.sheets.find((one) => one.name === named.replace(/^'|'$/gu, '')) ?? sheet)

  const top = Math.min(range.from.row, range.to.row)
  const bottom = Math.max(range.from.row, range.to.row)
  const left = Math.min(range.from.column, range.to.column)
  const right = Math.max(range.from.column, range.to.column)

  const values: string[] = []
  for (let row = top; row <= bottom; row += 1) {
    for (let column = left; column <= right; column += 1) {
      const text = shownText(open, from.cells.rows.get(row)?.get(column) ?? null)
      // An empty cell in the middle of a list is a gap somebody left, not a
      // choice called "".
      if (text !== '') values.push(text)
    }
  }

  return values
}

/** Why a value was refused, or null when it was not. */
export interface Refusal {
  rule: DataValidation
  /** What to tell whoever typed it. */
  message: string
}

/**
 * Whether what was typed is allowed, and what to say if it is not.
 *
 * The severity decides what the caller does about it: `stop` means the value
 * does not go in, and the other two mean it does and somebody is told. That
 * is Excel's arrangement, and it matters — a warning that refused the value
 * would be a stop with a friendlier face.
 */
export function refusalFor(
  open: OpenWorkbook,
  sheet: OpenSheet,
  cell: CellAddress,
  typed: string,
): Refusal | null {
  const rule = ruleAt(sheet, cell)
  if (rule === null || rule.kind === 'none' || rule.kind === 'custom') return null

  const text = typed.trim()
  if (text === '') return rule.allowBlank ? null : refuse(rule, 'This cell cannot be left empty.')

  if (rule.kind === 'list') {
    const choices = choicesOf(open, sheet, rule)
    if (choices.length === 0) return null
    if (choices.some((one) => one.toLowerCase() === text.toLowerCase())) return null

    return refuse(rule, `This cell takes one of: ${choices.join(', ')}.`)
  }

  const value = measured(rule, text, open.workbook.date1904)
  if (value === null) return refuse(rule, wanted(rule))

  const first = operand(rule.formula1, open.workbook.date1904)
  const second = operand(rule.formula2, open.workbook.date1904)
  if (first === null) return null

  return compare(value, rule, first, second) ? null : refuse(rule, wanted(rule))
}

const refuse = (rule: DataValidation, said: string): Refusal => ({
  rule,
  message: rule.errorMessage ?? said,
})

/** The number a typed value comes to, for the kind of rule being applied. */
function measured(rule: DataValidation, text: string, date1904: boolean): number | null {
  // Counted in letters rather than in bytes, as `LEN` counts them.
  if (rule.kind === 'textLength') return Array.from(text).length

  const parsed = parseInput(text, { date1904 })
  if (typeof parsed.value !== 'number') return null
  if (rule.kind === 'whole' && !Number.isInteger(parsed.value)) return null

  return parsed.value
}

function operand(formula: string | null, date1904: boolean): number | null {
  if (formula === null) return null

  const plain = formula.replace(/^=/u, '').trim()
  const parsed = parseInput(plain, { date1904 })

  return typeof parsed.value === 'number' ? parsed.value : null
}

function compare(
  value: number,
  rule: DataValidation,
  first: number,
  second: number | null,
): boolean {
  switch (rule.operator) {
    case 'between':
      return second !== null && value >= Math.min(first, second) && value <= Math.max(first, second)
    case 'notBetween':
      return second === null || value < Math.min(first, second) || value > Math.max(first, second)
    case 'equal':
      return value === first
    case 'notEqual':
      return value !== first
    case 'greaterThan':
      return value > first
    case 'lessThan':
      return value < first
    case 'greaterThanOrEqual':
      return value >= first
    case 'lessThanOrEqual':
      return value <= first
  }
}

/** What the rule asks for, said plainly, for a rule that says nothing itself. */
function wanted(rule: DataValidation): string {
  const kind =
    rule.kind === 'whole'
      ? 'a whole number'
      : rule.kind === 'decimal'
        ? 'a number'
        : rule.kind === 'date'
          ? 'a date'
          : rule.kind === 'time'
            ? 'a time'
            : 'a value'

  const first = rule.formula1?.replace(/^=/u, '') ?? ''
  const second = rule.formula2?.replace(/^=/u, '') ?? ''

  switch (rule.operator) {
    case 'between':
      return `This cell takes ${kind} between ${first} and ${second}.`
    case 'notBetween':
      return `This cell takes ${kind} outside ${first} to ${second}.`
    case 'equal':
      return `This cell takes ${kind} equal to ${first}.`
    case 'notEqual':
      return `This cell takes ${kind} other than ${first}.`
    case 'greaterThan':
      return `This cell takes ${kind} over ${first}.`
    case 'lessThan':
      return `This cell takes ${kind} under ${first}.`
    case 'greaterThanOrEqual':
      return `This cell takes ${kind} of ${first} or more.`
    case 'lessThanOrEqual':
      return `This cell takes ${kind} of ${first} or less.`
  }
}
