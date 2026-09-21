import { addRelationship } from '@orangery/ooxml-core'
import type { Relationship } from '@orangery/ooxml-core'
import { attribute, children, parseXml, tagName } from '@orangery/ooxml-core'
import { formatReference, parseRange } from './reference'
import { withoutCells } from './sheet-data'
import type { CellRange } from './reference'

/**
 * `<hyperlinks>` — the cells that are also a way somewhere else.
 *
 * A link is not part of a cell. It is a rectangle in a list of its own, like
 * a merge, which is why a cell can be a link without anything in the cell
 * saying so — and why deleting the value leaves the link where it was.
 *
 * Where it points is kept in two different places depending on where it goes.
 * Somewhere outside the workbook is a relationship, because that is how OOXML
 * holds anything a package does not contain; somewhere inside it is the
 * `location` attribute, written in the file itself. A reader that knew only
 * one of them would follow half the links it met.
 */

export interface Hyperlink {
  /** The cell, or the rectangle of them, that is the link. */
  range: CellRange
  /** Where it goes outside the workbook, or null for somewhere inside it. */
  target: string | null
  /** Where it goes inside the workbook: `Sheet2!A1`, or a defined name. */
  location: string | null
  /** What to show while the pointer waits over it. */
  tooltip: string | null
  /** The relationship it came in on, kept so a rewrite can reuse it. */
  relationshipId: string | null
}

const HYPERLINK_RELATIONSHIP =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink'

/**
 * The links of a worksheet, with the external ones resolved.
 *
 * The relationships are needed and not optional: a `<hyperlink>` with an
 * `r:id` and nothing else says only that it goes somewhere.
 */
export function readHyperlinks(
  xml: string,
  relationships: ReadonlyMap<string, Relationship>,
): Hyperlink[] {
  const root = parseXml(withoutCells(xml)).find((node) => tagName(node) === 'worksheet')
  if (root === undefined) return []

  const list = children(root).find((node) => tagName(node) === 'hyperlinks')
  if (list === undefined) return []

  return children(list).flatMap((node): Hyperlink[] => {
    if (tagName(node) !== 'hyperlink') return []

    const range = parseRange(attribute(node, 'ref') ?? '')
    if (range === null) return []

    const id = attribute(node, 'r:id') ?? attribute(node, 'id') ?? null

    return [
      {
        range,
        target: id === null ? null : (relationships.get(id)?.target ?? null),
        location: attribute(node, 'location') ?? null,
        tooltip: attribute(node, 'tooltip') ?? null,
        relationshipId: id,
      },
    ]
  })
}

const bounds = (range: CellRange) => ({
  top: Math.min(range.from.row, range.to.row),
  bottom: Math.max(range.from.row, range.to.row),
  left: Math.min(range.from.column, range.to.column),
  right: Math.max(range.from.column, range.to.column),
})

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

/** The link a cell is part of, or null — which is nearly every cell. */
export const linkCovering = (
  links: readonly Hyperlink[],
  cell: { row: number; column: number },
): Hyperlink | null =>
  links.find((link) => {
    const area = bounds(link.range)
    return (
      cell.row >= area.top &&
      cell.row <= area.bottom &&
      cell.column >= area.left &&
      cell.column <= area.right
    )
  }) ?? null

/**
 * The list with one more, and whatever it lands on taken out.
 *
 * Two links cannot cover one cell — Excel writes the first and ignores the
 * rest — so putting one in means taking out what it overlaps, exactly as a
 * merge does.
 */
export const withLink = (links: readonly Hyperlink[], link: Hyperlink): Hyperlink[] => [
  ...links.filter((one) => !overlaps(one.range, link.range)),
  link,
]

/** The links that do not touch a range, which is what removing one leaves. */
export const withoutLinks = (links: readonly Hyperlink[], range: CellRange): Hyperlink[] =>
  links.filter((link) => !overlaps(link.range, range))

const escaped = (text: string): string =>
  text.replace(
    /[&<>"]/gu,
    (one) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[one] ?? ''};`,
  )

/**
 * The list as the element a worksheet keeps it in, with the relationships it
 * needs added to the map it was given.
 *
 * The map is changed rather than returned because it belongs to the part's
 * own `.rels`, which the caller has to write anyway; handing back a second
 * copy would be inviting somebody to write one and not the other.
 */
export function writeHyperlinks(
  links: readonly Hyperlink[],
  relationships: Map<string, Relationship>,
): string {
  if (links.length === 0) return ''

  const written = links
    .map((link) => {
      const area = bounds(link.range)
      const from = formatReference({ row: area.top, column: area.left })
      const to = formatReference({ row: area.bottom, column: area.right })
      const ref = from === to ? from : `${from}:${to}`

      const id = link.target === null ? null : idFor(link, relationships)

      return (
        `<hyperlink ref="${ref}"` +
        (id === null ? '' : ` r:id="${id}"`) +
        (link.location === null ? '' : ` location="${escaped(link.location)}"`) +
        (link.tooltip === null ? '' : ` tooltip="${escaped(link.tooltip)}"`) +
        '/>'
      )
    })
    .join('')

  return `<hyperlinks>${written}</hyperlinks>`
}

/**
 * The relationship a link goes out on: the one it came in on, if it still
 * points where the link does, or a new one.
 *
 * Reused rather than replaced, so a file opened and saved keeps the ids it
 * had — the whole of what round-tripping means in this package.
 */
function idFor(link: Hyperlink, relationships: Map<string, Relationship>): string {
  const target = link.target ?? ''

  if (link.relationshipId !== null) {
    const existing = relationships.get(link.relationshipId)
    if (existing?.target === target) return link.relationshipId
  }

  for (const [id, one] of relationships) {
    if (one.type === HYPERLINK_RELATIONSHIP && one.target === target) return id
  }

  return addRelationship(relationships, HYPERLINK_RELATIONSHIP, target, true).id
}

/**
 * A worksheet with its `<hyperlinks>` replaced and everything else left alone.
 *
 * After the conditional formatting and before the print settings, which is
 * where the schema puts it: an element out of order is a file Excel offers to
 * repair.
 */
export function replaceHyperlinks(xml: string, written: string): string {
  const existing = /<hyperlinks(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/hyperlinks>)/u.exec(xml)

  if (existing !== null) {
    return xml.slice(0, existing.index) + written + xml.slice(existing.index + existing[0].length)
  }

  if (written === '') return xml

  // Before the first of the things that follow it, or after the last of the
  // things that come before — in that order, because a part may have neither.
  const before =
    /<printOptions|<pageMargins|<pageSetup|<headerFooter|<drawing|<legacyDrawing|<tableParts|<extLst/u.exec(
      xml,
    )
  if (before !== null) return xml.slice(0, before.index) + written + xml.slice(before.index)

  const after =
    /<\/conditionalFormatting>|<dataValidations(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/dataValidations>)|<\/mergeCells>|<autoFilter(?:\s[^>]*)?(?:\/>|>[\s\S]*?<\/autoFilter>)|<\/sheetData>|<sheetData(?:\s[^>]*)?\/>/gu

  let last: RegExpExecArray | null = null
  for (const match of xml.matchAll(after)) last = match
  if (last === null) return xml

  const at = last.index + last[0].length
  return xml.slice(0, at) + written + xml.slice(at)
}
