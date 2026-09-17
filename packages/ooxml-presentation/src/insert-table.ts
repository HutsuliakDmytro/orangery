import { attribute, children, element, getPartText, parseXml, tagName } from '@orangery/ooxml-core'
import type { OoxmlPackage } from '@orangery/ooxml-core'
import { nextShapeId } from './arrange'
import type { SlidePart } from './deck'
import { TABLE_STYLES_PART } from './parts'

/**
 * Putting a table on a slide.
 *
 * A table is not a shape: it is an `a:tbl` inside a `p:graphicFrame`, which is
 * the box that holds something drawn by another part of the format. The frame
 * states its own `p:xfrm`, and the table inside states the grid — a column
 * width per column, a height per row.
 *
 * Every cell exists from the start, empty. There is no sparse form: a table
 * with a missing `a:tc` is one PowerPoint refuses, which is the same reason a
 * merge keeps the cells it swallowed.
 */

const TABLE_URI = 'http://schemas.openxmlformats.org/drawingml/2006/table'

/**
 * The style a new table takes.
 *
 * Read from the deck's own `tableStyles.xml`, which names its default in a
 * `def` attribute. Hardcoding a GUID would give every deck the same table
 * regardless of the theme it was built with.
 */
export function defaultTableStyle(pkg: OoxmlPackage): string | null {
  const text = getPartText(pkg, TABLE_STYLES_PART)
  if (text === undefined) return null

  const list = parseXml(text).find((node) => tagName(node) === 'a:tblStyleLst')
  return list === undefined ? null : (attribute(list, 'def') ?? null)
}

export interface NewTable {
  rows: number
  columns: number
  /** In EMU. */
  transform: { x: number; y: number; width: number; height: number }
}

function cell(): ReturnType<typeof element> {
  return element('a:tc', {}, [
    element('a:txBody', {}, [element('a:bodyPr'), element('a:lstStyle'), element('a:p')]),
    element('a:tcPr'),
  ])
}

export function insertTable(pkg: OoxmlPackage, part: SlidePart, table: NewTable): number | null {
  const rows = Math.max(Math.round(table.rows), 1)
  const columns = Math.max(Math.round(table.columns), 1)
  if (table.transform.width <= 0 || table.transform.height <= 0) return null

  const id = nextShapeId(part)
  const round = (value: number) => String(Math.round(value))

  // Even columns and rows, which is what PowerPoint inserts; a row grows later
  // to fit its text and writes the grown height back.
  const columnWidth = table.transform.width / columns
  const rowHeight = table.transform.height / rows
  const style = defaultTableStyle(pkg)

  const grid = element(
    'a:tblGrid',
    {},
    Array.from({ length: columns }, () => element('a:gridCol', { w: round(columnWidth) })),
  )

  const body = Array.from({ length: rows }, () =>
    element(
      'a:tr',
      { h: round(rowHeight) },
      Array.from({ length: columns }, () => cell()),
    ),
  )

  const node = element('p:graphicFrame', {}, [
    element('p:nvGraphicFramePr', {}, [
      element('p:cNvPr', { id: String(id), name: `Table ${String(id)}` }),
      // A table cannot be part of a group, which PowerPoint states here.
      element('p:cNvGraphicFramePr', {}, [element('a:graphicFrameLocks', { noGrp: '1' })]),
      element('p:nvPr'),
    ]),
    element('p:xfrm', {}, [
      element('a:off', { x: round(table.transform.x), y: round(table.transform.y) }),
      element('a:ext', {
        cx: round(table.transform.width),
        cy: round(table.transform.height),
      }),
    ]),
    element('a:graphic', {}, [
      element('a:graphicData', { uri: TABLE_URI }, [
        element('a:tbl', {}, [
          element(
            'a:tblPr',
            { firstRow: '1', bandRow: '1' },
            style === null ? [] : [element('a:tableStyleId', {}, [{ '#text': style }])],
          ),
          grid,
          ...body,
        ]),
      ]),
    ]),
  ])

  children(part.tree).push(node)
  return id
}
