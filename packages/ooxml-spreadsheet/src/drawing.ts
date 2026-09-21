import {
  attribute,
  children,
  findChild,
  findDescendant,
  parseXml,
  tagName,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { movedEnd, movedStart } from './band'
import type { BandChange } from './formulas'
import { withoutCells } from './sheet-data'

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
  const root = parseXml(withoutCells(sheetXml)).find((node) => localName(node) === 'worksheet')
  if (root === undefined) return null

  const drawing = findChild(root, 'drawing')
  return drawing === undefined ? null : (attribute(drawing, 'r:id') ?? null)
}

const escaped = (text: string): string =>
  text
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;')

const point = (tag: 'from' | 'to', at: AnchorPoint): string =>
  `<xdr:${tag}><xdr:col>${String(at.column)}</xdr:col>` +
  `<xdr:colOff>${String(Math.round(at.columnOffset))}</xdr:colOff>` +
  `<xdr:row>${String(at.row)}</xdr:row>` +
  `<xdr:rowOff>${String(Math.round(at.rowOffset))}</xdr:rowOff></xdr:${tag}>`

const extent = (width: number, height: number): string =>
  `<xdr:ext cx="${String(Math.round(width))}" cy="${String(Math.round(height))}"/>`

/**
 * What goes inside an anchor: the thing being anchored.
 *
 * A chart is a `graphicFrame` naming the chart part through a relationship;
 * a picture is a `pic` naming an image the same way. Anything this does not
 * model is written back as the empty frame it was read as — which never
 * happens, because a drawing that was read as `other` is written from the
 * bytes it arrived in rather than from here.
 */
function contentXml(drawing: SheetDrawing, at: number): string {
  const id = String(at + 2)
  const name = escaped(drawing.name === '' ? `Drawing ${id}` : drawing.name)

  if (drawing.content.kind === 'chart') {
    return (
      `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr>` +
      `<xdr:cNvPr id="${id}" name="${name}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>` +
      '<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm>' +
      '<a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart">' +
      `<c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" ` +
      `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `r:id="${escaped(drawing.content.relationshipId)}"/>` +
      '</a:graphicData></a:graphic></xdr:graphicFrame>'
    )
  }

  if (drawing.content.kind === 'picture') {
    return (
      '<xdr:pic><xdr:nvPicPr>' +
      `<xdr:cNvPr id="${id}" name="${name}"/><xdr:cNvPicPr/></xdr:nvPicPr>` +
      `<xdr:blipFill><a:blip xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" ` +
      `r:embed="${escaped(drawing.content.relationshipId)}"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill>` +
      '<xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic>'
    )
  }

  // A shape or a group this does not model. It is written as an empty frame
  // so that the anchors around it keep their places rather than shuffling up.
  return (
    `<xdr:sp macro="" textlink=""><xdr:nvSpPr><xdr:cNvPr id="${id}" name="${name}"/>` +
    '<xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr/></xdr:sp>'
  )
}

/**
 * The drawings of a sheet as the part that holds them.
 *
 * Written rather than patched, unlike everything else in a worksheet: a
 * drawing part is ours from the moment we make one, and a sheet that had none
 * has no bytes to keep. A sheet that *did* have one keeps its own part
 * untouched unless a drawing was added — the caller decides that, because
 * only the caller knows whether anything moved.
 */
export function writeSheetDrawings(drawings: readonly SheetDrawing[]): string {
  const anchors = drawings
    .map((drawing, at) => {
      const inside = contentXml(drawing, at) + '<xdr:clientData/>'
      const anchor = drawing.anchor

      if (anchor.kind === 'two') {
        const editAs = drawing.editAs === null ? '' : ` editAs="${escaped(drawing.editAs)}"`
        return (
          `<xdr:twoCellAnchor${editAs}>${point('from', anchor.from)}${point('to', anchor.to)}` +
          `${inside}</xdr:twoCellAnchor>`
        )
      }

      if (anchor.kind === 'one') {
        return (
          `<xdr:oneCellAnchor>${point('from', anchor.from)}` +
          `${extent(anchor.width, anchor.height)}${inside}</xdr:oneCellAnchor>`
        )
      }

      return (
        `<xdr:absoluteAnchor><xdr:pos x="${String(Math.round(anchor.x))}" ` +
        `y="${String(Math.round(anchor.y))}"/>${extent(anchor.width, anchor.height)}` +
        `${inside}</xdr:absoluteAnchor>`
      )
    })
    .join('')

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" ' +
    `xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`
  )
}

/**
 * A worksheet told which drawing part belongs to it.
 *
 * `<drawing>` goes last but one, after everything else the schema allows and
 * before the extension list — an element out of order is a file Excel offers
 * to repair.
 */
export function replaceDrawingReference(xml: string, relationshipId: string): string {
  const written = `<drawing r:id="${escaped(relationshipId)}"/>`
  const existing = /<drawing\s[^>]*\/>/u.exec(xml)

  if (existing !== null) {
    return xml.slice(0, existing.index) + written + xml.slice(existing.index + existing[0].length)
  }

  const before = /<legacyDrawing|<tableParts|<extLst/u.exec(xml)
  if (before !== null) return xml.slice(0, before.index) + written + xml.slice(before.index)

  const at = xml.lastIndexOf('</worksheet>')
  return at === -1 ? xml : xml.slice(0, at) + written + xml.slice(at)
}

/**
 * A drawing part seen from after rows or columns moved under it.
 *
 * Patched as text rather than rewritten from the model, which is the opposite
 * of how a drawing part is written everywhere else here and is the point. A
 * shape, a connector, a piece of SmartArt is read into the model as "something
 * that is not a chart or a picture", and regenerating the part turns it into
 * an empty frame. That is a price worth paying when somebody adds a chart; it
 * is not a price worth paying when somebody inserts a row.
 *
 * So only the numbers in `<xdr:from>` and `<xdr:to>` change, and everything
 * around them — every element this does not model, every attribute it has
 * never heard of — stays exactly where it was.
 *
 * The two ends move by different rules, which is what makes a drawing over an
 * insertion get taller rather than move: `from` is the first line still in it
 * and `to` is the last. A drawing whose rows are all deleted is flattened
 * rather than removed, because taking it out would mean taking out the chart
 * part and the relationship behind it, and a row deleted is not somebody
 * asking for that.
 */
export function adjustDrawingAnchors(xml: string, change: BandChange): string {
  if (change.by === 0) return xml

  const line = change.axis === 'row' ? 'row' : 'col'
  const blocks = new RegExp(String.raw`<(\w+:)?(from|to)>([\s\S]*?)</\1?\2>`, 'gu')

  return xml.replace(blocks, (whole, prefix: string | undefined, end: string, inside: string) => {
    const moved = inside.replace(
      new RegExp(String.raw`<(\w+:)?${line}>(-?\d+)</\1?${line}>`, 'u'),
      (part, tag: string | undefined, digits: string) => {
        const index = Number(digits)
        const to = end === 'to' ? movedEnd(index, change) : movedStart(index, change)
        if (to === index) return part

        const name = `${tag ?? ''}${line}`
        return `<${name}>${String(Math.max(0, to))}</${name}>`
      },
    )

    return moved === inside ? whole : `<${prefix ?? ''}${end}>${moved}</${prefix ?? ''}${end}>`
  })
}
