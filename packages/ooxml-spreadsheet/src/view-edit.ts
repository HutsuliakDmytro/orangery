import { formatReference } from './reference'
import type { FrozenPanes } from './worksheet'
import { elementPattern, openingPattern } from './patterns'

/**
 * `<sheetView>` — how a sheet is looked at rather than what is in it.
 *
 * Freezing, the zoom, whether the gridlines are drawn. None of it changes a
 * value and all of it is remembered in the file, which is the point: a
 * workbook put away at 60 % with its header row frozen opens that way, and a
 * reader that forgot would be showing somebody a different sheet from the one
 * they left.
 *
 * Patched textually, like everything else inside a worksheet
 * (`apps/sheets/docs/adr/0002-xlsx-roundtrip.md`). A `<sheetView>` carries a
 * dozen attributes nothing here models — the colour of the grid, the page
 * break view, where the cursor was — and only the named ones are touched.
 */

/** What can be said about a view without saying anything about the cells. */
export interface ViewChange {
  /** As a percentage; 100 is unzoomed. */
  zoom?: number
  showGridLines?: boolean
  /** Null unfreezes, which is the same element taken away. */
  panes?: FrozenPanes | null
}

const SHEET_VIEW = elementPattern('sheetView')

/**
 * The `<pane>` element for a freeze at a cell.
 *
 * `topLeftCell` is the first cell of the moving part, and `activePane` names
 * it, because a frozen sheet has up to four panes and Excel needs to know
 * which one the cursor is in. Both follow from the split, so neither is asked
 * for.
 */
function paneElement(panes: FrozenPanes): string {
  const { rows, columns } = panes
  if (rows === 0 && columns === 0) return ''

  const corner = formatReference({ row: rows, column: columns })
  const active = columns === 0 ? 'bottomLeft' : rows === 0 ? 'topRight' : 'bottomRight'

  const split =
    (columns === 0 ? '' : ` xSplit="${String(columns)}"`) +
    (rows === 0 ? '' : ` ySplit="${String(rows)}"`)

  return (
    `<pane${split} topLeftCell="${corner}" activePane="${active}" state="frozen"/>` +
    `<selection pane="${active}" activeCell="${corner}" sqref="${corner}"/>`
  )
}

/** An attribute set, replaced, or taken off where it is the default. */
function attributed(attributes: string, name: string, value: string | null): string {
  const without = attributes.replace(new RegExp(`\\s${name}="[^"]*"`, 'u'), '')
  return value === null ? without : `${without} ${name}="${value}"`
}

/**
 * A worksheet with its view changed and everything else left alone.
 *
 * A part with no `<sheetViews>` at all gets one: it is optional in the schema
 * and Excel writes it always, so a file that lacks it is one made by
 * something else — and the element has to go before `<sheetData>`, which is
 * why it is put there rather than appended.
 */
export function changeView(xml: string, change: ViewChange): string {
  const found = SHEET_VIEW.exec(xml)

  if (found === null) {
    const written = viewElement('', change)
    if (written === '') return xml

    const data = openingPattern('sheetData').exec(xml)
    if (data === null) return xml

    return xml.slice(0, data.index) + `<sheetViews>${written}</sheetViews>` + xml.slice(data.index)
  }

  return (
    xml.slice(0, found.index) + rewritten(found, change) + xml.slice(found.index + found[0].length)
  )
}

/** One `<sheetView>` with the named parts changed. */
function rewritten(found: RegExpExecArray, change: ViewChange): string {
  let attributes = found[1] ?? ''

  if (change.zoom !== undefined) {
    // 100 is the default, and an attribute saying so is noise in the file.
    const stated = change.zoom === 100 ? null : String(Math.round(change.zoom))
    attributes = attributed(attributes, 'zoomScale', stated)
    attributes = attributed(attributes, 'zoomScaleNormal', stated)
  }

  if (change.showGridLines !== undefined) {
    attributes = attributed(attributes, 'showGridLines', change.showGridLines ? null : '0')
  }

  const inside = found[2] ?? '/>'
  const body = inside === '/>' ? '' : inside.replace(/^>/u, '').replace(/<\/sheetView>$/u, '')

  const kept =
    change.panes === undefined
      ? body
      : withoutPanes(body) + (change.panes === null ? '' : paneElement(change.panes))

  return kept === '' ? `<sheetView${attributes}/>` : `<sheetView${attributes}>${kept}</sheetView>`
}

/**
 * The inside of a view with the freeze taken out.
 *
 * The selections go with it: they name panes that will not exist, and Excel
 * repairs a file whose `<selection pane="bottomLeft">` has no bottom left.
 */
const withoutPanes = (body: string): string =>
  body.replace(elementPattern('pane', 'gu'), '').replace(elementPattern('selection', 'gu'), '')

/** A whole `<sheetView>` for a part that had none. */
function viewElement(_: string, change: ViewChange): string {
  const zoom =
    change.zoom === undefined || change.zoom === 100
      ? ''
      : ` zoomScale="${String(Math.round(change.zoom))}" zoomScaleNormal="${String(Math.round(change.zoom))}"`
  const grid = change.showGridLines === false ? ' showGridLines="0"' : ''
  const panes = change.panes == null ? '' : paneElement(change.panes)

  if (zoom === '' && grid === '' && panes === '') return ''

  return panes === ''
    ? `<sheetView${zoom}${grid} workbookViewId="0"/>`
    : `<sheetView${zoom}${grid} workbookViewId="0">${panes}</sheetView>`
}
