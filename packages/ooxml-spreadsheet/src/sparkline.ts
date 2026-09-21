import { attribute, children, findChild, parseXml, tagName, textValue } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { parseReference } from './reference'
import type { CellPosition } from './reference'

/**
 * `x14:sparklineGroups` — the charts that live in a cell.
 *
 * Sparklines were added to the format after it was finished, so they are in
 * the extension list rather than in the sheet proper: a reader that has never
 * heard of them sees a sheet with an `<extLst>` it can ignore, which is
 * exactly what the extension list is for and one of the few places OOXML's
 * forward compatibility actually worked.
 *
 * A group holds its look — the colours, the kind of chart — and a list of
 * sparklines, each one a cell and the range it is drawn from. The grouping is
 * how Excel makes a column of them at once, and why changing the colour of
 * one changes all of them.
 */

export interface Sparkline {
  /** Where it is drawn. */
  cell: CellPosition
  /** What it is drawn from, as written: `Sheet1!B2:E2`. */
  formula: string
}

export interface SparklineGroup {
  /** `line`, `column`, or `stacked` — which is what Excel calls win/loss. */
  kind: 'line' | 'column' | 'stacked'
  /** The series colour, as `FFRRGGBB`, or null for the reader's default. */
  color: string | null
  negativeColor: string | null
  /** Whether an empty cell is a gap, a nought, or joined across. */
  emptyAs: string
  sparklines: Sparkline[]
}

const SPARKLINE_EXTENSION = '{05C60535-1F16-4FD2-B633-F4F36F0B64E0}'

const localName = (node: XmlNode): string => (tagName(node) ?? '').replace(/^.*:/u, '')

const colorOf = (group: XmlNode, name: string): string | null => {
  const node = children(group).find((one) => localName(one) === name)
  return node === undefined ? null : (attribute(node, 'rgb') ?? null)
}

/** The sparkline groups of a worksheet, in the order the file states them. */
export function readSparklines(xml: string): SparklineGroup[] {
  const root = parseXml(xml).find((node) => tagName(node) === 'worksheet')
  return root === undefined ? [] : readSparklinesIn(root)
}

/** The same, for whoever has already read the worksheet into a tree. */
export function readSparklinesIn(root: XmlNode): SparklineGroup[] {
  const list = findChild(root, 'extLst')
  if (list === undefined) return []

  return children(list).flatMap((extension) => {
    if (localName(extension) !== 'ext') return []

    // The uri says which extension this is; a file has several and the rest
    // are somebody else's business.
    const uri = (attribute(extension, 'uri') ?? '').toUpperCase()
    if (uri !== SPARKLINE_EXTENSION) return []

    const groups = children(extension).find((one) => localName(one) === 'sparklineGroups')
    if (groups === undefined) return []

    return children(groups).flatMap((group): SparklineGroup[] => {
      if (localName(group) !== 'sparklineGroup') return []

      const stated = attribute(group, 'type') ?? 'line'
      const kind = stated === 'column' || stated === 'stacked' ? stated : 'line'

      const inside = children(group).find((one) => localName(one) === 'sparklines')
      const sparklines = (inside === undefined ? [] : children(inside)).flatMap(
        (one): Sparkline[] => {
          if (localName(one) !== 'sparkline') return []

          const formula = children(one).find((child) => localName(child) === 'f')
          const where = children(one).find((child) => localName(child) === 'sqref')
          const cell = parseReference(inner(where))
          if (cell === null) return []

          return [{ cell, formula: inner(formula) }]
        },
      )

      return sparklines.length === 0
        ? []
        : [
            {
              kind,
              color: colorOf(group, 'colorSeries'),
              negativeColor: colorOf(group, 'colorNegative'),
              emptyAs: attribute(group, 'displayEmptyCellsAs') ?? 'gap',
              sparklines,
            },
          ]
    })
  })
}

const inner = (node: XmlNode | undefined): string =>
  node === undefined ? '' : children(node).map(textValue).join('').trim()

/** The sparkline drawn in a cell, and the group whose look it takes. */
export function sparklineAt(
  groups: readonly SparklineGroup[],
  cell: CellPosition,
): { group: SparklineGroup; sparkline: Sparkline } | null {
  for (const group of groups) {
    const found = group.sparklines.find(
      (one) => one.cell.row === cell.row && one.cell.column === cell.column,
    )
    if (found !== undefined) return { group, sparkline: found }
  }

  return null
}
