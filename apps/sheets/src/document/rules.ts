import { differentialWith, rangeCovers } from '@orangery/ooxml-spreadsheet'
import type {
  ConditionalFormat,
  ConditionalRule,
  DifferentialFormat,
} from '@orangery/ooxml-spreadsheet'
import type { CellAddress, GridSelection } from '@orangery/grid'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * The rules that change how a cell looks because of what is in it.
 *
 * Reading them has worked for months; this is making one. The awkward half is
 * not the rule but the look: a rule does not carry its colours, it carries a
 * number pointing into `dxfs` — a list of looks the workbook keeps — so
 * making a rule red means finding or adding a red in that list first.
 *
 * Which is the same arrangement cells have with `cellXfs`, and for the same
 * reason: a workbook with ten thousand red cells holds one red.
 */

/** The three looks Excel offers first, and the ones people pick. */
export const LOOKS = {
  red: { fill: 'FFFFC7CE', text: 'FF9C0006' },
  yellow: { fill: 'FFFFEB9C', text: 'FF9C6500' },
  green: { fill: 'FFC6EFCE', text: 'FF006100' },
} as const

export type LookName = keyof typeof LOOKS

/** What a highlight rule asks about. */
export type RuleKind =
  'greaterThan' | 'lessThan' | 'between' | 'equal' | 'containsText' | 'duplicateValues'

const differential = (look: LookName): DifferentialFormat => ({
  font: { color: { kind: 'rgb', hex: LOOKS[look].text } },
  fill: {
    pattern: 'solid',
    foreground: { kind: 'rgb', hex: LOOKS[look].fill },
    background: { kind: 'auto' },
    gradient: false,
  },
  border: null,
  numberFormat: null,
})

/**
 * A rule made over what is selected.
 *
 * Its own block rather than a rule added to one that is already there: two
 * rules over the same cells is ordinary — a red for the low numbers and a
 * green for the high ones — and the ranges they cover are rarely the same.
 *
 * The priority is one lower than everything else, which puts it first. That
 * is where Excel puts a new rule, and it is the only sensible place: somebody
 * who has just made a rule is looking at the cells it was for.
 */
export function addRule(
  open: OpenWorkbook,
  sheet: OpenSheet,
  selection: GridSelection,
  asked: { kind: RuleKind; first: string; second: string; look: LookName },
): ConditionalRule | null {
  const styles = open.styles
  if (styles === null) return null

  const ranges = selection.ranges.map((range) => ({
    sheet: null,
    from: {
      row: Math.min(range.anchor.row, range.focus.row),
      column: Math.min(range.anchor.column, range.focus.column),
    },
    to: {
      row: Math.max(range.anchor.row, range.focus.row),
      column: Math.max(range.anchor.column, range.focus.column),
    },
  }))
  if (ranges.length === 0) return null

  const highest = sheet.sheet.conditional.flatMap((format) =>
    format.rules.map((rule) => rule.priority),
  )
  const priority = Math.min(1, ...highest.map((one) => one - 1))

  const dxfId = differentialWith(styles, open.styleChanges, differential(asked.look))
  const rule = ruleFor(asked, priority, dxfId)
  if (rule === null) return null

  sheet.sheet.conditional.push({ ranges, rules: [rule] })
  return rule
}

function ruleFor(
  asked: { kind: RuleKind; first: string; second: string },
  priority: number,
  dxfId: number,
): ConditionalRule | null {
  const base: ConditionalRule = {
    type: 'cellIs',
    priority,
    stopIfTrue: false,
    dxfId,
    operator: null,
    text: null,
    formulas: [],
    rank: null,
    percent: false,
    bottom: false,
    above: true,
    equalAverage: false,
    standardDeviation: null,
    timePeriod: null,
    colorScale: null,
    dataBar: null,
    iconSet: null,
  }

  const first = asked.first.trim()
  const second = asked.second.trim()

  switch (asked.kind) {
    case 'duplicateValues':
      // The one rule that asks about the range rather than about a cell.
      return { ...base, type: 'duplicateValues' }
    case 'containsText':
      if (first === '') return null
      return { ...base, type: 'containsText', operator: 'containsText', text: first }
    case 'between':
      if (first === '' || second === '') return null
      return { ...base, operator: 'between', formulas: [first, second] }
    default: {
      if (first === '') return null
      const operator =
        asked.kind === 'greaterThan'
          ? 'greaterThan'
          : asked.kind === 'lessThan'
            ? 'lessThan'
            : 'equal'
      return { ...base, operator, formulas: [first] }
    }
  }
}

/** Every rule covering a cell, with the block it belongs to. */
export function rulesAt(
  sheet: OpenSheet,
  cell: CellAddress,
): { format: ConditionalFormat; rule: ConditionalRule }[] {
  return sheet.sheet.conditional.flatMap((format) =>
    format.ranges.some((range) => rangeCovers(range, cell))
      ? format.rules.map((rule) => ({ format, rule }))
      : [],
  )
}

/**
 * A rule taken off, and the block with it if that was the last of them.
 *
 * A block with no rules left is not an empty block: it is a `sqref` covering
 * cells for no reason, which Excel writes as nothing at all.
 */
export function removeRule(sheet: OpenSheet, rule: ConditionalRule): boolean {
  for (const [at, format] of sheet.sheet.conditional.entries()) {
    const index = format.rules.indexOf(rule)
    if (index === -1) continue

    format.rules.splice(index, 1)
    if (format.rules.length === 0) sheet.sheet.conditional.splice(at, 1)

    return true
  }

  return false
}

/** What a rule says, in words, for a list somebody reads. */
export function ruleSaid(rule: ConditionalRule): string {
  if (rule.type === 'duplicateValues') return 'Duplicate values'
  if (rule.type === 'containsText') return `Text contains ${rule.text ?? ''}`
  if (rule.type === 'colorScale') return 'Colour scale'
  if (rule.type === 'dataBar') return 'Data bars'
  if (rule.type === 'iconSet') return 'Icon set'

  const said: Record<string, string> = {
    greaterThan: 'Greater than',
    lessThan: 'Less than',
    between: 'Between',
    equal: 'Equal to',
    notEqual: 'Not equal to',
    greaterThanOrEqual: 'At least',
    lessThanOrEqual: 'At most',
  }

  const operator = said[rule.operator ?? ''] ?? rule.type
  return `${operator} ${rule.formulas.join(' and ')}`.trim()
}
