import {
  attribute,
  children,
  findChild,
  findDescendant,
  parseXml,
  tagName,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * What sits on top of a worksheet rather than in it.
 *
 * Charts, pictures, shapes. None of them are in a cell: a drawing part holds a
 * list of things and, for each, an anchor saying which cell corner it starts
 * at and which it ends at. That is why a chart moves when a column is widened
 * and why it does not belong to any cell.
 *
 * The anchor is in cells plus an offset in EMU, and it is kept that way. A
 * reader that converted to pixels here would have to be told the zoom, the
 * column widths and the font before it could answer, and all three change
 * without the file changing.
 */

/** English Metric Units: 914 400 to the inch, 12 700 to the point. */
export const EMU_PER_POINT = 12_700

/** A corner of a drawing, as the file states it: a cell and a way into it. */
export interface AnchorPoint {
  column: number
  /** How far into that column, in EMU. */
  columnOffset: number
  row: number
  rowOffset: number
}

export type DrawingAnchor =
  /** Both corners pinned to cells: the drawing resizes with the rows and columns. */
  | { kind: 'two'; from: AnchorPoint; to: AnchorPoint }
  /** One corner pinned and a fixed size: it moves with the cells but does not stretch. */
  | { kind: 'one'; from: AnchorPoint; width: number; height: number }
  /** Pinned to the sheet itself, which nothing in the grid can move. */
  | { kind: 'absolute'; x: number; y: number; width: number; height: number }

export type DrawingContent =
  | { kind: 'chart'; relationshipId: string }
  | { kind: 'picture'; relationshipId: string }
  /**
   * A shape, a connector, a group, a piece of SmartArt.
   *
   * Recognised and not drawn. Keeping it in the list is the point: something
   * that knows how many drawings a sheet has can say so, and a drawing that
   * vanished from the model would be a drawing nobody noticed was missing.
   */
  | { kind: 'other'; what: string }

export interface SheetDrawing {
  anchor: DrawingAnchor
  content: DrawingContent
  /** What the selection pane calls it. */
  name: string
  /**
   * How the drawing behaves when the cells under it move, as the file asks.
   *
   * `twoCell` resizes, `oneCell` moves without resizing, `absolute` does
   * neither. It repeats what the anchor already implies and Excel writes both.
   */
  editAs: string | null
}

/** The tag without whichever prefix this file happens to use for it. */
const localName = (node: XmlNode): string => {
  const tag = tagName(node) ?? ''
  const colon = tag.indexOf(':')
  return colon === -1 ? tag : tag.slice(colon + 1)
}

const childNamed = (node: XmlNode, name: string): XmlNode | undefined =>
  children(node).find((child) => localName(child) === name)

const number = (node: XmlNode | undefined, name: string): number => {
  const value = Number(textIn(node === undefined ? undefined : childNamed(node, name)))
  return Number.isFinite(value) ? value : 0
}

/** The text of an element, which is where a drawing keeps its numbers. */
function textIn(node: XmlNode | undefined): string {
  if (node === undefined) return ''

  return children(node)
    .map((child) => (typeof child['#text'] === 'string' ? child['#text'] : textIn(child)))
    .join('')
}

const pointOf = (node: XmlNode | undefined): AnchorPoint => ({
  column: number(node, 'col'),
  columnOffset: number(node, 'colOff'),
  row: number(node, 'row'),
  rowOffset: number(node, 'rowOff'),
})

function extentOf(node: XmlNode): { width: number; height: number } {
  const ext = childNamed(node, 'ext')
  return {
    width: Number(attribute(ext ?? {}, 'cx')) || 0,
    height: Number(attribute(ext ?? {}, 'cy')) || 0,
  }
}

function anchorOf(node: XmlNode): DrawingAnchor | null {
  const kind = localName(node)
  const from = childNamed(node, 'from')

  if (kind === 'twoCellAnchor') {
    const to = childNamed(node, 'to')
    return to === undefined ? null : { kind: 'two', from: pointOf(from), to: pointOf(to) }
  }

  if (kind === 'oneCellAnchor') {
    return { kind: 'one', from: pointOf(from), ...extentOf(node) }
  }

  if (kind === 'absoluteAnchor') {
    const position = childNamed(node, 'pos')
    return {
      kind: 'absolute',
      x: Number(attribute(position ?? {}, 'x')) || 0,
      y: Number(attribute(position ?? {}, 'y')) || 0,
      ...extentOf(node),
    }
  }

  return null
}

/** The `c:chart` reference a graphic frame wraps, for a frame that holds one. */
function chartIn(frame: XmlNode): string | null {
  const graphic = findDescendant(frame, 'c:chart')
  if (graphic === undefined) return null

  // `r:id` is how nearly every file writes it; the relationship attribute has
  // been spelled with other prefixes and the local name is the constant part.
  return attribute(graphic, 'r:id') ?? attribute(graphic, 'id') ?? null
}

function contentOf(anchor: XmlNode): { content: DrawingContent; name: string } | null {
  for (const child of children(anchor)) {
    const kind = localName(child)

    if (kind === 'graphicFrame') {
      const chart = chartIn(child)
      return chart === null
        ? { content: { kind: 'other', what: 'graphicFrame' }, name: nameOf(child) }
        : { content: { kind: 'chart', relationshipId: chart }, name: nameOf(child) }
    }

    if (kind === 'pic') {
      const blip = findDescendant(child, 'a:blip')
      const id = blip === undefined ? null : (attribute(blip, 'r:embed') ?? null)
      return id === null
        ? { content: { kind: 'other', what: 'pic' }, name: nameOf(child) }
        : { content: { kind: 'picture', relationshipId: id }, name: nameOf(child) }
    }

    if (kind === 'sp' || kind === 'cxnSp' || kind === 'grpSp') {
      return { content: { kind: 'other', what: kind }, name: nameOf(child) }
    }
  }

  return null
}

/** The name in whichever properties element this kind of drawing keeps. */
function nameOf(node: XmlNode): string {
  for (const properties of ['nvGraphicFramePr', 'nvPicPr', 'nvSpPr', 'nvCxnSpPr', 'nvGrpSpPr']) {
    const container = childNamed(node, properties)
    if (container === undefined) continue

    const visual = childNamed(container, 'cNvPr')
    const name = attribute(visual ?? {}, 'name')
    if (name !== undefined) return name
  }

  return ''
}

/**
 * Everything a drawing part puts on a sheet, in the order it is drawn.
 *
 * The order is the file's, and it is the z-order: a picture written after a
 * chart sits on top of it.
 */
export function readSheetDrawings(xml: string): SheetDrawing[] {
  const root = parseXml(xml).find((node) => localName(node) === 'wsDr')
  if (root === undefined) return []

  return children(root).flatMap((node) => {
    const anchor = anchorOf(node)
    const what = anchor === null ? null : contentOf(node)
    if (anchor === null || what === null) return []

    return [
      {
        anchor,
        content: what.content,
        name: what.name,
        editAs: attribute(node, 'editAs') ?? null,
      },
    ]
  })
}

/** The drawing part a worksheet points at, or null where it has none. */
export function drawingRelationshipId(sheetXml: string): string | null {
  const root = parseXml(sheetXml).find((node) => localName(node) === 'worksheet')
  if (root === undefined) return null

  const drawing = findChild(root, 'drawing')
  return drawing === undefined ? null : (attribute(drawing, 'r:id') ?? null)
}
