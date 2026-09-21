import { paperSize, parseRange, printArea, printTitles } from '@orangery/ooxml-spreadsheet'
import type { PageSetup } from '@orangery/ooxml-spreadsheet'
import type { OpenSheet, OpenWorkbook } from './workbook'

/**
 * Printing, and the PDF that comes out of the same dialog.
 *
 * Through the webview, as the other two apps do: Tauri's window has no PDF
 * renderer of its own, and using one would mean a second layout engine that
 * disagrees with what is on screen. On macOS the print sheet has "Save as
 * PDF" in it, which is the export.
 *
 * A sheet is the hard case of the three. A document has pages in it and a
 * deck is a list of them; a spreadsheet is one plane of cells that nothing
 * divides, so everything here exists to answer where the pages end — what is
 * printed at all, how wide the paper is, and whether the sheet is shrunk to
 * fit rather than cut down the middle.
 *
 * What is printed is not the canvas. The canvas holds the cells somebody is
 * looking at; printing wants the ones they are not, so the print view is an
 * ordinary table of HTML that the browser paginates, with the title rows in a
 * `<thead>` so that it repeats them on every page for us.
 */

export const PAGE_STYLE_ID = 'orangery-page-rule'

/** Inches to points, which is what `@page` wants and the file does not use. */
const points = (inches: number): number => inches * 72

/**
 * The `@page` rule a sheet's setup comes to.
 *
 * The scale is not in here: CSS has no way to say "shrink to one page wide",
 * so a sheet that asks to be fitted is fitted by the caller, in the zoom of
 * the table it prints.
 */
export function pageRule(setup: PageSetup): string {
  const paper = paperSize(setup.paper, setup.landscape)
  const { margins } = setup

  return `@page {
  size: ${String(paper.width)}pt ${String(paper.height)}pt;
  margin: ${String(points(margins.top))}pt ${String(points(margins.right))}pt ${String(
    points(margins.bottom),
  )}pt ${String(points(margins.left))}pt;
}`
}

/**
 * Installs the rule before printing.
 *
 * `@page` cannot be set from an inline style and the values change with the
 * sheet, so the rule is written into a stylesheet the app owns and replaces.
 */
export function applyPageRule(setup: PageSetup): void {
  if (typeof document === 'undefined') return

  let style = document.getElementById(PAGE_STYLE_ID)
  if (!(style instanceof HTMLStyleElement)) {
    style = document.createElement('style')
    style.id = PAGE_STYLE_ID
    document.head.append(style)
  }

  style.textContent = pageRule(setup)
}

export interface PrintBounds {
  top: number
  bottom: number
  left: number
  right: number
}

/**
 * What gets printed: the print area if the workbook states one, and
 * everything there is otherwise.
 *
 * Excel keeps the print area as a defined name scoped to the sheet, which is
 * why this needs the workbook rather than only the sheet.
 */
export function boundsToPrint(open: OpenWorkbook, sheet: OpenSheet): PrintBounds | null {
  const at = open.sheets.indexOf(sheet)
  const stated = printArea(open.workbook.definedNames, at)
  const range = stated === null ? null : parseRange(stated)

  if (range !== null) {
    return {
      top: Math.min(range.from.row, range.to.row),
      bottom: Math.max(range.from.row, range.to.row),
      left: Math.min(range.from.column, range.to.column),
      right: Math.max(range.from.column, range.to.column),
    }
  }

  let bottom = -1
  let right = -1
  for (const [row, cells] of sheet.cells.rows) {
    for (const column of cells.keys()) {
      bottom = Math.max(bottom, row)
      right = Math.max(right, column)
    }
  }

  return bottom < 0 ? null : { top: 0, bottom, left: 0, right }
}

/**
 * The rows repeated at the top of every page.
 *
 * `_xlnm.Print_Titles` states them as whole rows — `Sheet1!$1:$2` — which is
 * why only the rows are taken from it: a repeated column would have to be
 * repeated by the table's own layout, and a browser will not do that.
 */
export function titleRows(
  open: OpenWorkbook,
  sheet: OpenSheet,
): { top: number; bottom: number } | null {
  const at = open.sheets.indexOf(sheet)
  const stated = printTitles(open.workbook.definedNames, at)
  if (stated === null) return null

  const rows = /\$(\d+):\$(\d+)/u.exec(stated)
  if (rows === null) return null

  const top = Number(rows[1]) - 1
  const bottom = Number(rows[2]) - 1

  return Number.isFinite(top) && Number.isFinite(bottom)
    ? { top: Math.min(top, bottom), bottom: Math.max(top, bottom) }
    : null
}

/** Opens the system print dialog, with the sheet's own page rule in place. */
export function printSheet(setup: PageSetup): void {
  applyPageRule(setup)
  if (typeof window !== 'undefined') window.print()
}
