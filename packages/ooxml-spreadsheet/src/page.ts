import { attribute, findChild, parseXml, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'

/**
 * How a sheet is meant to come out of a printer.
 *
 * Nothing about a spreadsheet says where its pages end — it is one plane of
 * cells — so every one of these settings exists to answer that: how wide the
 * paper is, which way round, how much of it is margin, and whether the sheet
 * should be shrunk to fit rather than cut.
 *
 * Read into a model rather than left verbatim because printing has to obey
 * them, and because "fit to one page wide" is the setting people set and
 * then forget they set.
 */

export interface PageSetup {
  /** `1` is Letter, `9` is A4; the numbers are the printer's, not ours. */
  paper: number
  landscape: boolean
  /** Per cent, as the file states it: 100 is full size. */
  scale: number
  /**
   * How many pages wide and tall the sheet is squeezed into.
   *
   * Null for "as many as it takes", which is what a sheet says when it is
   * not being fitted at all. Zero in the file means the same as null and is
   * read as null, because a sheet nought pages wide is not a thing.
   */
  fitToWidth: number | null
  fitToHeight: number | null
  /** Whether the scale above is used, or the fitting is. */
  fitToPage: boolean
  /** In inches, as the file keeps them. */
  margins: {
    left: number
    right: number
    top: number
    bottom: number
    header: number
    footer: number
  }
  /** Whether the gridlines and the row and column headings are printed. */
  gridLines: boolean
  headings: boolean
  /** Whether the sheet is centred on the page. */
  centreHorizontally: boolean
  centreVertically: boolean
}

/** What Excel gives a sheet nobody has set up: Letter, portrait, inch margins. */
export const DEFAULT_PAGE: PageSetup = {
  paper: 1,
  landscape: false,
  scale: 100,
  fitToWidth: null,
  fitToHeight: null,
  fitToPage: false,
  margins: { left: 0.7, right: 0.7, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 },
  gridLines: false,
  headings: false,
  centreHorizontally: false,
  centreVertically: false,
}

const number = (node: XmlNode | undefined, name: string, fallback: number): number => {
  const value = Number(attribute(node ?? {}, name))
  return Number.isFinite(value) ? value : fallback
}

const flag = (node: XmlNode | undefined, name: string, fallback = false): boolean => {
  const value = attribute(node ?? {}, name)
  if (value === undefined) return fallback
  return value === '1' || value === 'true'
}

const fitting = (node: XmlNode | undefined, name: string): number | null => {
  const value = Number(attribute(node ?? {}, name))
  // Nought means "as many as it takes", which is what null means here.
  return Number.isFinite(value) && value > 0 ? value : null
}

/** What a worksheet says about printing, with Excel's defaults for the rest. */
export function readPageSetup(xml: string): PageSetup {
  const root = parseXml(xml).find((node) => tagName(node) === 'worksheet')
  if (root === undefined) return DEFAULT_PAGE

  return readPageSetupIn(root)
}

/** The same, for whoever has already read the worksheet into a tree. */
export function readPageSetupIn(root: XmlNode): PageSetup {
  const setup = findChild(root, 'pageSetup')
  const margins = findChild(root, 'pageMargins')
  const options = findChild(root, 'printOptions')
  const properties = findChild(root, 'sheetPr')
  const page = properties === undefined ? undefined : findChild(properties, 'pageSetUpPr')

  return {
    paper: number(setup, 'paperSize', DEFAULT_PAGE.paper),
    landscape: attribute(setup ?? {}, 'orientation') === 'landscape',
    scale: number(setup, 'scale', DEFAULT_PAGE.scale),
    fitToWidth: fitting(setup, 'fitToWidth'),
    fitToHeight: fitting(setup, 'fitToHeight'),
    fitToPage: flag(page, 'fitToPage', false),
    margins: {
      left: number(margins, 'left', DEFAULT_PAGE.margins.left),
      right: number(margins, 'right', DEFAULT_PAGE.margins.right),
      top: number(margins, 'top', DEFAULT_PAGE.margins.top),
      bottom: number(margins, 'bottom', DEFAULT_PAGE.margins.bottom),
      header: number(margins, 'header', DEFAULT_PAGE.margins.header),
      footer: number(margins, 'footer', DEFAULT_PAGE.margins.footer),
    },
    gridLines: flag(options, 'gridLines', false),
    headings: flag(options, 'headings', false),
    centreHorizontally: flag(options, 'horizontalCentered', false),
    centreVertically: flag(options, 'verticalCentered', false),
  }
}

/**
 * The paper a number stands for, in points.
 *
 * The numbers are the printer driver's and the list is long; these are the
 * sizes anybody in this program is likely to have set, and anything else
 * falls back to A4 — which is wrong for somebody in America and less wrong
 * than refusing to print.
 */
export function paperSize(paper: number, landscape: boolean): { width: number; height: number } {
  const sizes: Record<number, { width: number; height: number }> = {
    1: { width: 612, height: 792 },
    5: { width: 612, height: 1008 },
    8: { width: 842, height: 1191 },
    9: { width: 595, height: 842 },
    11: { width: 420, height: 595 },
  }

  const size = sizes[paper] ?? sizes[9] ?? { width: 595, height: 842 }
  return landscape ? { width: size.height, height: size.width } : size
}

/**
 * The print area a workbook states for a sheet, as written.
 *
 * Excel keeps it as a defined name — `_xlnm.Print_Area`, scoped to the sheet
 * — rather than in the sheet itself, which is why this takes the names and a
 * sheet's position rather than its XML.
 */
export function printArea(
  names: readonly { name: string; formula: string; sheet: number | null }[],
  sheet: number,
): string | null {
  const found = names.find((one) => one.name === '_xlnm.Print_Area' && one.sheet === sheet)

  return found?.formula ?? null
}

/** The rows and columns repeated on every page, likewise. */
export function printTitles(
  names: readonly { name: string; formula: string; sheet: number | null }[],
  sheet: number,
): string | null {
  const found = names.find((one) => one.name === '_xlnm.Print_Titles' && one.sheet === sheet)

  return found?.formula ?? null
}
