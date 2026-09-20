import { attribute, attributes, children, parseXml, tagName, textValue } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { formatReference, parseRange } from './reference'
import type { CellRange } from './reference'

/**
 * `<dataValidations>` — what a cell is allowed to hold.
 *
 * A rule is a rectangle and a condition, like conditional formatting and
 * unlike a style: it belongs to the sheet rather than to the cells, so
 * clearing a cell leaves the rule where it was. That is what makes a column
 * of dropdowns survive somebody emptying it.
 *
 * The attribute worth knowing about is `showDropDown`, which means the
 * opposite of what it says. `showDropDown="1"` *hides* the in-cell arrow —
 * the name is about a dialog Excel no longer shows — so a reader that took it
 * at face value would put arrows on every cell that asked for none and none
 * on every cell that asked for one. It is stored here as what it does.
 */

export type ValidationKind =
  'none' | 'whole' | 'decimal' | 'list' | 'date' | 'time' | 'textLength' | 'custom'

export type ValidationOperator =
  | 'between'
  | 'notBetween'
  | 'equal'
  | 'notEqual'
  | 'greaterThan'
  | 'lessThan'
  | 'greaterThanOrEqual'
  | 'lessThanOrEqual'

/** What happens when somebody types something the rule does not allow. */
export type ValidationSeverity = 'stop' | 'warning' | 'information'

export interface DataValidation {
  /** The rectangles it covers; `sqref` can name several at once. */
  ranges: CellRange[]
  kind: ValidationKind
  operator: ValidationOperator
  /** The first operand, as written: a number, a date, a range, a list. */
  formula1: string | null
  /** The second, for `between` and `notBetween`. */
  formula2: string | null
  /** Whether an empty cell is allowed, which it is unless the rule says not. */
  allowBlank: boolean
  /** Whether the cell shows an arrow of its own. See the note above. */
  dropDown: boolean
  severity: ValidationSeverity
  errorTitle: string | null
  errorMessage: string | null
  promptTitle: string | null
  promptMessage: string | null
  /** Attributes this does not model, kept so they survive a save. */
  carried: Record<string, string> | null
}

const KINDS: ValidationKind[] = [
  'none',
  'whole',
  'decimal',
  'list',
  'date',
  'time',
  'textLength',
  'custom',
]

const OPERATORS: ValidationOperator[] = [
  'between',
  'notBetween',
  'equal',
  'notEqual',
  'greaterThan',
  'lessThan',
  'greaterThanOrEqual',
  'lessThanOrEqual',
]

const MODELLED = new Set([
  'type',
  'operator',
  'sqref',
  'allowBlank',
  'showDropDown',
  'showErrorMessage',
  'showInputMessage',
  'errorStyle',
  'errorTitle',
  'error',
  'promptTitle',
  'prompt',
])

const flag = (node: XmlNode, name: string, fallback = false): boolean => {
  const value = attribute(node, name)
  if (value === undefined) return fallback
  return value === '1' || value === 'true'
}

/** The rules of a worksheet, in the order the file states them. */
export function readValidations(xml: string): DataValidation[] {
  const root = parseXml(xml).find((node) => tagName(node) === 'worksheet')
  if (root === undefined) return []

  const list = children(root).find((node) => tagName(node) === 'dataValidations')
  if (list === undefined) return []

  return children(list).flatMap((node): DataValidation[] => {
    if (tagName(node) !== 'dataValidation') return []

    const ranges = (attribute(node, 'sqref') ?? '')
      .split(/\s+/u)
      .map((one) => parseRange(one))
      .filter((one): one is CellRange => one !== null)

    if (ranges.length === 0) return []

    const kind = attribute(node, 'type') ?? 'none'
    const operator = attribute(node, 'operator') ?? 'between'
    const formulas = children(node).filter((child) => tagName(child)?.startsWith('formula'))

    const carried: Record<string, string> = {}
    for (const [name, value] of Object.entries(attributes(node))) {
      if (!MODELLED.has(name)) carried[name] = value
    }

    return [
      {
        ranges,
        kind: KINDS.includes(kind as ValidationKind) ? (kind as ValidationKind) : 'none',
        operator: OPERATORS.includes(operator as ValidationOperator)
          ? (operator as ValidationOperator)
          : 'between',
        formula1: textOf(formulas[0]),
        formula2: textOf(formulas[1]),
        allowBlank: flag(node, 'allowBlank'),
        // The attribute means the opposite of its name, so it is stored as
        // what it does rather than as what it says.
        dropDown: !flag(node, 'showDropDown'),
        severity: severityOf(attribute(node, 'errorStyle')),
        errorTitle: attribute(node, 'errorTitle') ?? null,
        errorMessage: attribute(node, 'error') ?? null,
        promptTitle: attribute(node, 'promptTitle') ?? null,
        promptMessage: attribute(node, 'prompt') ?? null,
        carried: Object.keys(carried).length === 0 ? null : carried,
      },
    ]
  })
}

function textOf(node: XmlNode | undefined): string | null {
  if (node === undefined) return null

  // The words of an element rather than the element: `<formula1>1</formula1>`
  // keeps its `1` in a text node under it.
  const text = children(node).map(textValue).join('').trim()
  return text === '' ? null : text
}

function severityOf(written: string | undefined): ValidationSeverity {
  if (written === 'warning') return 'warning'
  if (written === 'information') return 'information'
  // Excel's own default, and the one that stops a wrong value getting in.
  return 'stop'
}

/** The rule covering a cell, or null — which is most cells. */
export function validationAt(
  validations: readonly DataValidation[],
  cell: { row: number; column: number },
): DataValidation | null {
  // The last one wins, as it does in Excel: a rule laid over another is a
  // rule somebody added later.
  for (let at = validations.length - 1; at >= 0; at -= 1) {
    const rule = validations[at]
    if (rule === undefined) continue

    const covers = rule.ranges.some(
      (range) =>
        cell.row >= Math.min(range.from.row, range.to.row) &&
        cell.row <= Math.max(range.from.row, range.to.row) &&
        cell.column >= Math.min(range.from.column, range.to.column) &&
        cell.column <= Math.max(range.from.column, range.to.column),
    )

    if (covers) return rule
  }

  return null
}

const escaped = (text: string): string =>
  text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')

const reference = (range: CellRange): string => {
  const from = formatReference(range.from)
  const to = formatReference(range.to)
  return from === to ? from : `${from}:${to}`
}

/** The rules of a sheet as the element that holds them. */
export function writeValidations(validations: readonly DataValidation[]): string {
  if (validations.length === 0) return ''

  const written = validations
    .map((rule) => {
      const attributes: string[] = []
      if (rule.kind !== 'none') attributes.push(`type="${rule.kind}"`)
      if (rule.operator !== 'between') attributes.push(`operator="${rule.operator}"`)
      if (rule.allowBlank) attributes.push('allowBlank="1"')
      // Written the way the file says it, which is the opposite of what the
      // model holds.
      if (!rule.dropDown) attributes.push('showDropDown="1"')
      if (rule.severity !== 'stop') attributes.push(`errorStyle="${rule.severity}"`)
      if (rule.errorMessage !== null) {
        attributes.push('showErrorMessage="1"')
        if (rule.errorTitle !== null) attributes.push(`errorTitle="${escaped(rule.errorTitle)}"`)
        attributes.push(`error="${escaped(rule.errorMessage)}"`)
      }
      if (rule.promptMessage !== null) {
        attributes.push('showInputMessage="1"')
        if (rule.promptTitle !== null) attributes.push(`promptTitle="${escaped(rule.promptTitle)}"`)
        attributes.push(`prompt="${escaped(rule.promptMessage)}"`)
      }
      for (const [name, value] of Object.entries(rule.carried ?? {})) {
        attributes.push(`${name}="${escaped(value)}"`)
      }
      attributes.push(`sqref="${rule.ranges.map(reference).join(' ')}"`)

      const formulas = [rule.formula1, rule.formula2]
        .map((formula, at) =>
          formula === null
            ? ''
            : `<formula${String(at + 1)}>${escaped(formula)}</formula${String(at + 1)}>`,
        )
        .join('')

      return formulas === ''
        ? `<dataValidation ${attributes.join(' ')}/>`
        : `<dataValidation ${attributes.join(' ')}>${formulas}</dataValidation>`
    })
    .join('')

  return `<dataValidations count="${String(validations.length)}">${written}</dataValidations>`
}

/**
 * The rules put back into a worksheet.
 *
 * After the merges and the conditional formatting and before the hyperlinks,
 * which is where the schema puts them: an element out of order is a file
 * Excel offers to repair.
 */
export function replaceValidations(xml: string, written: string): string {
  const existing = /<dataValidations(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/dataValidations>)/u.exec(xml)

  if (existing !== null) {
    return xml.slice(0, existing.index) + written + xml.slice(existing.index + existing[0].length)
  }

  if (written === '') return xml

  const before =
    /<hyperlinks|<printOptions|<pageMargins|<pageSetup|<headerFooter|<drawing|<legacyDrawing|<tableParts|<extLst/u.exec(
      xml,
    )
  if (before !== null) return xml.slice(0, before.index) + written + xml.slice(before.index)

  const after =
    /<\/conditionalFormatting>|<\/mergeCells>|<autoFilter(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/autoFilter>)|<\/sheetData>|<sheetData(?:\s[^>]*)?\/>/gu

  let last: RegExpExecArray | null = null
  for (const match of xml.matchAll(after)) last = match
  if (last === null) return xml

  const at = last.index + last[0].length
  return xml.slice(0, at) + written + xml.slice(at)
}
