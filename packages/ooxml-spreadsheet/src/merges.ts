import { formatReference } from './reference'
import type { CellRange } from './reference'

/**
 * `<mergeCells>` — the cells a sheet draws as one.
 *
 * A merge is not a property of a cell. It is a rectangle the sheet keeps in a
 * list of its own, and the cells inside it go on existing: the corner keeps
 * its value and the rest are still there, empty, still addressable. That is
 * why merging and unmerging change a list rather than a cell, and why
 * unmerging a range gives back cells rather than conjuring them.
 *
 * Two merges cannot overlap — Excel refuses a file where they do — so putting
 * one in means taking out whatever it lands on.
 */

const overlaps = (a: CellRange, b: CellRange): boolean => {
  const first = bounds(a)
  const second = bounds(b)

  return (
    first.top <= second.bottom &&
    first.bottom >= second.top &&
    first.left <= second.right &&
    first.right >= second.left
  )
}

const bounds = (range: CellRange) => ({
  top: Math.min(range.from.row, range.to.row),
  bottom: Math.max(range.from.row, range.to.row),
  left: Math.min(range.from.column, range.to.column),
  right: Math.max(range.from.column, range.to.column),
})

/** The merges that do not touch a range, which is what unmerging leaves. */
export const withoutMerges = (merges: readonly CellRange[], range: CellRange): CellRange[] =>
  merges.filter((merge) => !overlaps(merge, range))

/**
 * The merges with one more, and whatever it lands on taken out.
 *
 * A range of one cell merges nothing: it is what somebody asking to unmerge
 * a single cell means, and adding it would put a merge in the file that
 * Excel writes as a merge of one and every other reader ignores.
 */
export function withMerge(merges: readonly CellRange[], range: CellRange): CellRange[] {
  const area = bounds(range)
  if (area.top === area.bottom && area.left === area.right) return withoutMerges(merges, range)

  return [
    ...withoutMerges(merges, range),
    {
      sheet: null,
      from: { row: area.top, column: area.left },
      to: { row: area.bottom, column: area.right },
    },
  ]
}

/** The merge a cell belongs to, or null — which is nearly every cell. */
export const mergeCovering = (
  merges: readonly CellRange[],
  cell: { row: number; column: number },
): CellRange | null =>
  merges.find((merge) => {
    const area = bounds(merge)
    return (
      cell.row >= area.top &&
      cell.row <= area.bottom &&
      cell.column >= area.left &&
      cell.column <= area.right
    )
  }) ?? null

/** The list as the element a worksheet keeps it in, or nothing for none. */
export function writeMerges(merges: readonly CellRange[]): string {
  if (merges.length === 0) return ''

  const refs = merges
    .map((merge) => {
      const area = bounds(merge)
      const from = formatReference({ row: area.top, column: area.left })
      const to = formatReference({ row: area.bottom, column: area.right })
      return `<mergeCell ref="${from}:${to}"/>`
    })
    .join('')

  return `<mergeCells count="${String(merges.length)}">${refs}</mergeCells>`
}

/**
 * A worksheet with its `<mergeCells>` replaced and everything else left alone.
 *
 * Textual, like the cells and the columns. Where the part has none, the new
 * element goes immediately after `</sheetData>`, which is where the schema puts
 * it — a `mergeCells` before the cells is a file Excel offers to repair.
 */
export function replaceMerges(xml: string, merges: readonly CellRange[]): string {
  const written = writeMerges(merges)
  const existing = /<mergeCells(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/mergeCells>)/u.exec(xml)

  if (existing !== null) {
    return xml.slice(0, existing.index) + written + xml.slice(existing.index + existing[0].length)
  }

  if (written === '') return xml

  const data = /<\/sheetData>|<sheetData(?:\s[^>]*)?\/>/u.exec(xml)
  if (data === null) return xml

  const after = data.index + data[0].length
  return xml.slice(0, after) + written + xml.slice(after)
}
