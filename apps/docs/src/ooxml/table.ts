import {
  attribute,
  children,
  element,
  findChild,
  formatColor,
  parseColor,
  parseIntAttribute,
  parseXml,
  pointsToTwips,
  serializeNode,
  tagName,
  twipsToPoints,
} from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { bordersFrom } from './table-borders'
import type { ProseMirrorNodeJson } from './prosemirror-json'

/**
 * OOXML tables — `w:tbl`.
 *
 * Word's table model is grid-based: `w:tblGrid` declares the column widths, and
 * a cell spanning columns says so with `w:gridSpan`. Vertical merges are stated
 * per-cell with `w:vMerge` — `restart` on the first cell, `continue` on the ones
 * below — rather than as a rowspan on the top cell, which is the shape
 * ProseMirror uses. The two have to be translated in both directions.
 */

export interface TableCellProperties {
  colspan: number
  rowspan: number
  /** Column width in points, from the grid. */
  width: number | null
  background: string | null
}

const MODELLED_TABLE_PROPERTIES = new Set(['w:tblGrid', 'w:tblPr', 'w:tr'])

function cellProperties(cell: XmlNode): {
  colspan: number
  vMerge: string | null
  background: string | null
} {
  const tcPr = findChild(cell, 'w:tcPr')
  if (!tcPr) return { colspan: 1, vMerge: null, background: null }

  const gridSpan = parseIntAttribute(attribute(findChild(tcPr, 'w:gridSpan') ?? {}, 'w:val'))
  const merge = findChild(tcPr, 'w:vMerge')
  const shading = findChild(tcPr, 'w:shd')

  return {
    colspan: gridSpan === null || gridSpan < 1 ? 1 : gridSpan,
    // `<w:vMerge/>` with no value means `continue`, which is the easy one to miss.
    vMerge: merge === undefined ? null : (attribute(merge, 'w:val') ?? 'continue'),
    background: shading === undefined ? null : parseColor(attribute(shading, 'w:fill')),
  }
}

/** Column widths from `w:tblGrid`, in points. */
export function parseGrid(table: XmlNode): number[] {
  const grid = findChild(table, 'w:tblGrid')
  if (!grid) return []

  return children(grid)
    .filter((column) => tagName(column) === 'w:gridCol')
    .map((column) => {
      const width = parseIntAttribute(attribute(column, 'w:w'))
      return width === null ? 0 : twipsToPoints(width)
    })
}

/**
 * Converts `w:vMerge` chains into rowspans.
 *
 * Word marks the continuation cells; ProseMirror omits them and puts a rowspan
 * on the starting cell. Walking rows top-down, each `continue` extends the most
 * recent `restart` in the same grid column and is then dropped.
 */
export function parseTable(
  table: XmlNode,
  parseCellContent: (cell: XmlNode) => ProseMirrorNodeJson[],
): ProseMirrorNodeJson {
  const grid = parseGrid(table)
  const rows = children(table).filter((row) => tagName(row) === 'w:tr')

  // Rowspan owners by grid column, so a `continue` knows which cell to extend.
  const openMerges = new Map<number, ProseMirrorNodeJson>()
  const content: ProseMirrorNodeJson[] = []

  for (const row of rows) {
    const cells = children(row).filter((cell) => tagName(cell) === 'w:tc')
    const rowContent: ProseMirrorNodeJson[] = []
    let column = 0

    for (const cell of cells) {
      const properties = cellProperties(cell)

      if (properties.vMerge === 'continue') {
        const owner = openMerges.get(column)
        if (owner?.attrs) {
          const rowspan = owner.attrs['rowspan']
          owner.attrs['rowspan'] = (typeof rowspan === 'number' ? rowspan : 1) + 1

          // The continuation cell disappears from the ProseMirror model, but
          // Word still needs it in the file. It is carried whole on the owner —
          // properties and content — because its paragraph may hold formatting
          // that renders nothing yet still differs from an empty one.
          const carried = owner.attrs['mergedCells']
          owner.attrs['mergedCells'] = [
            ...(Array.isArray(carried) ? (carried as string[]) : []),
            serializeNode(cell),
          ]
        }
        column += properties.colspan
        continue
      }

      const width = grid
        .slice(column, column + properties.colspan)
        .reduce((total, value) => total + value, 0)

      const tcPr = findChild(cell, 'w:tcPr')

      const node: ProseMirrorNodeJson = {
        type: 'tableCell',
        attrs: {
          colspan: properties.colspan,
          rowspan: 1,
          colwidth: width > 0 ? [Math.round(width)] : null,
          ...(properties.background !== null ? { background: properties.background } : {}),
          // `w:tcPr` also carries cell width, borders and vertical alignment,
          // none of which we model. Keeping it whole lets an untouched cell be
          // written back exactly as found — the same approach `w:rFonts` uses.
          ...(tcPr ? { tcPr: serializeNode(tcPr), tcPrColspan: properties.colspan } : {}),
        },
        content: parseCellContent(cell),
      }

      if (properties.vMerge === 'restart') openMerges.set(column, node)
      else openMerges.delete(column)

      rowContent.push(node)
      column += properties.colspan
    }

    // Everything the row states before its cells, kept in order: `w:trPr`
    // holds the height and "repeat as header row", and `w:tblPrEx` — table
    // property exceptions, where a row disagrees with its table about borders
    // or margins — comes before it and was being dropped.
    const properties = children(row)
      .filter((child) => {
        const tag = tagName(child)
        return tag !== null && tag !== 'w:tc'
      })
      .map((child) => serializeNode(child))
      .join('')

    content.push({
      type: 'tableRow',
      ...(properties === '' ? {} : { attrs: { trPr: properties } }),
      content: rowContent,
    })
  }

  // Rowspans are only final once every row has been walked, so the value the
  // serialiser compares against is recorded here rather than during the loop.
  for (const row of content) {
    for (const cell of row.content ?? []) {
      if (cell.attrs && typeof cell.attrs['tcPr'] === 'string') {
        cell.attrs['tcPrRowspan'] = cell.attrs['rowspan']
      }
    }
  }

  const preserved = children(table)
    .filter((child) => {
      const tag = tagName(child)
      return tag !== null && !MODELLED_TABLE_PROPERTIES.has(tag)
    })
    .map(serializeNode)

  const gridNode = findChild(table, 'w:tblGrid')
  const tblPrNode = findChild(table, 'w:tblPr')

  return {
    type: 'table',
    attrs: {
      ...(grid.length > 0 ? { grid } : {}),
      // Widths arrive as fractional twips from Google Docs, which do not survive
      // a trip through points. The original element is written back when the
      // column count has not changed.
      ...(gridNode ? { tblGrid: serializeNode(gridNode), tblGridColumns: grid.length } : {}),
      // `w:tblPr` carries borders, style and layout we do not model; kept whole.
      ...(tblPrNode
        ? {
            tblPr: serializeNode(tblPrNode),
            // Borders are pulled out of the preserved properties so they can be
            // rendered and edited; the rest of `w:tblPr` stays untouched.
            borders: bordersFrom(serializeNode(tblPrNode)),
          }
        : {}),
      ...(preserved.length > 0 ? { preserved: preserved.join('') } : {}),
    },
    content,
  }
}

function numberAttr(
  attrs: Record<string, unknown> | undefined,
  key: string,
  fallback: number,
): number {
  const value = attrs?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

/**
 * Rebuilds `w:tbl`, turning rowspans back into `w:vMerge` chains and filling in
 * the continuation cells Word expects but ProseMirror does not store.
 */
export function serializeTable(
  node: ProseMirrorNodeJson,
  serializeCellContent: (cell: ProseMirrorNodeJson) => XmlNode[],
): XmlNode {
  const rows = node.content ?? []
  const columnCount = Math.max(
    0,
    ...rows.map((row) =>
      (row.content ?? []).reduce((total, cell) => total + numberAttr(cell.attrs, 'colspan', 1), 0),
    ),
  )

  // Cells that a rowspan above still covers, by grid column.
  const covered = new Map<number, number>()
  // The continuation cells the source had, queued per grid column.
  const continuationCells = new Map<number, string[]>()
  const rowNodes: XmlNode[] = []

  for (const row of rows) {
    const cellNodes: XmlNode[] = []
    let column = 0

    const skipCovered = () => {
      while ((covered.get(column) ?? 0) > 0) {
        const remaining = (covered.get(column) ?? 0) - 1
        covered.set(column, remaining)

        // Word needs a real cell here, marked as a merge continuation. When the
        // source had one it goes back verbatim; a newly merged cell gets the
        // minimum Word accepts.
        const original = continuationCells.get(column)?.shift()
        cellNodes.push(
          original === undefined
            ? element('w:tc', {}, [element('w:tcPr', {}, [element('w:vMerge')]), element('w:p')])
            : (parseFragment(original)[0] ?? element('w:tc', {}, [element('w:p')])),
        )
        column += 1
      }
    }

    for (const cell of row.content ?? []) {
      skipCovered()

      const colspan = numberAttr(cell.attrs, 'colspan', 1)
      const rowspan = numberAttr(cell.attrs, 'rowspan', 1)
      const background = cell.attrs?.['background']

      const originalTcPr = cell.attrs?.['tcPr']
      // Unchanged since parsing: write the original properties back untouched,
      // so cell width and borders survive. A structural edit rebuilds them, and
      // the properties we do not model are lost for that cell only.
      const unchanged =
        typeof originalTcPr === 'string' &&
        colspan === numberAttr(cell.attrs, 'tcPrColspan', -1) &&
        rowspan === numberAttr(cell.attrs, 'tcPrRowspan', -1)

      const propertyNodes: XmlNode[] = []
      if (unchanged) {
        propertyNodes.push(...parseFragment(originalTcPr))
      } else {
        const rebuilt: XmlNode[] = []
        if (colspan > 1) rebuilt.push(element('w:gridSpan', { 'w:val': String(colspan) }))
        if (rowspan > 1) rebuilt.push(element('w:vMerge', { 'w:val': 'restart' }))
        if (typeof background === 'string') {
          rebuilt.push(
            element('w:shd', {
              'w:val': 'clear',
              'w:color': 'auto',
              'w:fill': formatColor(background),
            }),
          )
        }
        if (rebuilt.length > 0) propertyNodes.push(element('w:tcPr', {}, rebuilt))
      }

      const content = serializeCellContent(cell)
      cellNodes.push(
        element('w:tc', {}, [
          ...propertyNodes,
          // A cell must contain at least one paragraph or Word rejects the file.
          ...(content.length > 0 ? content : [element('w:p')]),
        ]),
      )

      if (rowspan > 1) {
        for (let offset = 0; offset < colspan; offset += 1) {
          covered.set(column + offset, rowspan - 1)
        }
        const carried = cell.attrs?.['mergedCells']
        if (Array.isArray(carried)) {
          continuationCells.set(column, [...(carried as string[])])
        }
      }

      column += colspan
    }

    skipCovered()

    const trPr = row.attrs?.['trPr']
    rowNodes.push(
      element('w:tr', {}, [...(typeof trPr === 'string' ? parseFragment(trPr) : []), ...cellNodes]),
    )
  }

  const grid = node.attrs?.['grid']
  const widths = Array.isArray(grid) ? (grid as number[]) : []

  const originalGrid = node.attrs?.['tblGrid']
  const originalColumns = node.attrs?.['tblGridColumns']
  const gridUnchanged =
    typeof originalGrid === 'string' &&
    typeof originalColumns === 'number' &&
    originalColumns === widths.length

  const gridNode = gridUnchanged
    ? (parseFragment(originalGrid)[0] ?? element('w:tblGrid'))
    : element(
        'w:tblGrid',
        {},
        (widths.length > 0 ? widths : Array.from({ length: columnCount }, () => 0)).map((width) =>
          element('w:gridCol', width > 0 ? { 'w:w': String(pointsToTwips(width)) } : {}),
        ),
      )

  const tblPr = node.attrs?.['tblPr']
  const preserved = node.attrs?.['preserved']

  return element('w:tbl', {}, [
    ...(typeof tblPr === 'string' ? parseFragment(tblPr) : []),
    gridNode,
    ...rowNodes,
    ...(typeof preserved === 'string' ? parseFragment(preserved) : []),
  ])
}

/** Re-parses a preserved fragment so it can be written back in place. */
function parseFragment(xml: string): XmlNode[] {
  return parseXml(xml)
}
