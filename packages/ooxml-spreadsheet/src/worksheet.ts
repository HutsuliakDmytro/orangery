import { attribute, children, findChild, parseXml, tagName } from '@orangery/ooxml-core'
import type { XmlNode } from '@orangery/ooxml-core'
import { parseRange } from './reference'
import type { CellRange } from './reference'
import { readConditionalFormats } from './conditional'
import { readValidationsIn } from './validation'
import type { DataValidation } from './validation'
import { readPageSetupIn } from './page'
import type { PageSetup } from './page'
import { readSparklinesIn } from './sparkline'
import { withoutCells } from './sheet-data'
import type { SparklineGroup } from './sparkline'
import type { ConditionalFormat } from './conditional'
import { readAutoFilter } from './autofilter'
import type { AutoFilter } from './autofilter'

/**
 * A worksheet, apart from its cells.
 *
 * Everything here is small — a few dozen elements in the largest workbook —
 * which is why it is read as a tree while `sheetData` is scanned. It is also
 * everything the grid needs before it can draw a single cell correctly: how
 * wide the columns are, which rows are frozen, what is merged with what, and
 * how far the sheet claims to reach.
 *
 * What is not read here is not lost: the part is written back by putting new
 * cells into the original text, so every element this never looked at keeps
 * its own bytes (`apps/sheets/docs/adr/0002-xlsx-roundtrip.md`).
 */

export interface ColumnRange {
  /** Zero-based and inclusive, unlike the file, which counts from one. */
  from: number
  to: number
  /**
   * In characters of the default font's widest digit, as the file states it.
   *
   * Not converted here: what a character is depends on the font the workbook
   * was written with, and a reader that guessed would make every column a
   * little wrong on a machine with different fonts.
   */
  width: number | null
  hidden: boolean
  /** Whether the width was chosen rather than inherited. */
  custom: boolean
  style: number | null
  outlineLevel: number | null
  collapsed: boolean
}

export interface FrozenPanes {
  /** Columns held still at the left, and rows at the top. */
  columns: number
  rows: number
  /** Split rather than frozen: the panes move, they just move apart. */
  split: boolean
}

export interface SheetView {
  /** As a percentage; 100 is unzoomed. */
  zoom: number
  showGridLines: boolean
  showRowColHeaders: boolean
  rightToLeft: boolean
  /** Whether this is the view the workbook opens on. */
  active: boolean
  panes: FrozenPanes | null
  /** Where the cursor was left, which Excel restores on open. */
  selection: string | null
}

export interface SheetFormat {
  /** In points. */
  defaultRowHeight: number | null
  /** In characters, like a column's own width. */
  defaultColumnWidth: number | null
  /** Whether every row is taller than the font needs, which changes autofit. */
  customHeight: boolean
}

export interface Worksheet {
  /** What the file claims the cells reach, which is a hint and not a fact. */
  dimension: CellRange | null
  view: SheetView
  columns: ColumnRange[]
  merges: CellRange[]
  format: SheetFormat
  /** `a:srgbClr` of the tab, as written; themes are resolved by the renderer. */
  tabColor: string | null
  /**
   * The autofilter: the range its arrows sit on, and what each column keeps.
   *
   * Which rows are actually hidden is not here — that is written on the rows
   * themselves, and the criteria are the reason rather than the result.
   */
  autoFilter: AutoFilter | null
  /**
   * The rules that change how a cell looks because of what is in it.
   *
   * Not part of a cell's style and not resolvable without the neighbours: what
   * a colour scale makes of a cell depends on every other cell in its range
   * (`highlight.ts`).
   */
  conditional: ConditionalFormat[]
  /**
   * Whether the sheet is protected, and what that protection allows.
   *
   * Protection is not security. The password is a hash anybody can strip and
   * Microsoft has never claimed otherwise: it is there to stop somebody
   * typing over a formula by accident, which is a real thing to want and a
   * different thing from keeping a secret. What it is read for is to honour
   * it — and the hash is carried through a save untouched, because rewriting
   * it would be claiming to have checked it.
   */
  protection: SheetProtection | null
  /**
   * What its cells are allowed to hold.
   *
   * Read here rather than by whoever wants them, so that a sheet is read
   * once: a worksheet part can hold a million cells, and walking it twice to
   * find two small elements is a second walk over all of them.
   */
  validations: DataValidation[]
  /** How it is meant to come out of a printer. */
  page: PageSetup
  /** The charts that live in a cell, which the file keeps in its extensions. */
  sparklines: SparklineGroup[]
}

/** What a protected sheet allows anyway. */
export interface SheetProtection {
  /** Whether the cells are protected at all; `sheet="1"`. */
  cells: boolean
  /** Whether somebody may still select a cell that is locked. */
  selectLocked: boolean
  selectUnlocked: boolean
  formatCells: boolean
  insertRows: boolean
  insertColumns: boolean
  deleteRows: boolean
  deleteColumns: boolean
  sort: boolean
  autoFilter: boolean
}

/**
 * What `<sheetProtection>` says, with Excel's own defaults.
 *
 * Every `allow*` attribute is off unless stated, and the two about selecting
 * are on unless stated — so a bare `<sheetProtection sheet="1"/>` locks the
 * cells and lets somebody click about, which is what people mean by it.
 */
function readProtection(root: XmlNode): SheetProtection | null {
  const node = findChild(root, 'sheetProtection')
  if (node === undefined) return null

  return {
    cells: flag(node, 'sheet', false),
    selectLocked: !flag(node, 'selectLockedCells', false),
    selectUnlocked: !flag(node, 'selectUnlockedCells', false),
    formatCells: flag(node, 'formatCells', false),
    insertRows: flag(node, 'insertRows', false),
    insertColumns: flag(node, 'insertColumns', false),
    deleteRows: flag(node, 'deleteRows', false),
    deleteColumns: flag(node, 'deleteColumns', false),
    sort: flag(node, 'sort', false),
    autoFilter: flag(node, 'autoFilter', false),
  }
}

const DEFAULT_VIEW: SheetView = {
  zoom: 100,
  showGridLines: true,
  showRowColHeaders: true,
  rightToLeft: false,
  active: false,
  panes: null,
  selection: null,
}

const number = (node: XmlNode | undefined, name: string): number | null => {
  const value = Number(attribute(node ?? {}, name))
  return Number.isFinite(value) ? value : null
}

/**
 * A boolean attribute of the format.
 *
 * `1`, `true` and an empty attribute all mean yes; anything else means no. The
 * default matters as much as the value: `showGridLines` absent means the lines
 * are shown, and a reader that treated absence as false would draw every sheet
 * without them.
 */
const flag = (node: XmlNode | undefined, name: string, fallback: boolean): boolean => {
  const value = attribute(node ?? {}, name)
  if (value === undefined) return fallback
  return value === '1' || value === 'true'
}

function readPanes(view: XmlNode): FrozenPanes | null {
  const pane = findChild(view, 'pane')
  if (pane === undefined) return null

  const state = attribute(pane, 'state') ?? 'split'
  const columns = number(pane, 'xSplit') ?? 0
  const rows = number(pane, 'ySplit') ?? 0
  if (columns === 0 && rows === 0) return null

  // A frozen pane counts in rows and columns; a split one counts in twentieths
  // of a point, and the two are the same element with a different `state`.
  return { columns, rows, split: state !== 'frozen' && state !== 'frozenSplit' }
}

function readView(root: XmlNode): SheetView {
  const views = findChild(root, 'sheetViews')
  const view = views === undefined ? undefined : findChild(views, 'sheetView')
  if (view === undefined) return DEFAULT_VIEW

  const selection = findChild(view, 'selection')

  return {
    zoom: number(view, 'zoomScale') ?? 100,
    showGridLines: flag(view, 'showGridLines', true),
    showRowColHeaders: flag(view, 'showRowColHeaders', true),
    rightToLeft: flag(view, 'rightToLeft', false),
    active: flag(view, 'tabSelected', false),
    panes: readPanes(view),
    selection: selection === undefined ? null : (attribute(selection, 'activeCell') ?? null),
  }
}

function readColumns(root: XmlNode): ColumnRange[] {
  const cols = findChild(root, 'cols')
  if (cols === undefined) return []

  return children(cols).flatMap((col) => {
    if (tagName(col) !== 'col') return []

    const from = number(col, 'min')
    const to = number(col, 'max')
    if (from === null || to === null) return []

    return [
      {
        from: from - 1,
        to: to - 1,
        width: number(col, 'width'),
        hidden: flag(col, 'hidden', false),
        custom: flag(col, 'customWidth', false),
        style: flag(col, 'customFormat', false) ? number(col, 'style') : null,
        outlineLevel: number(col, 'outlineLevel'),
        collapsed: flag(col, 'collapsed', false),
      },
    ]
  })
}

function readMerges(root: XmlNode): CellRange[] {
  const merges = findChild(root, 'mergeCells')
  if (merges === undefined) return []

  return children(merges).flatMap((merge) => {
    const reference = attribute(merge, 'ref')
    const range = reference === undefined ? null : parseRange(reference)
    return range === null ? [] : [range]
  })
}

export function readWorksheet(xml: string): Worksheet | null {
  const root = parseXml(withoutCells(xml)).find((node) => tagName(node) === 'worksheet')
  if (root === undefined) return null

  const dimension = findChild(root, 'dimension')
  const format = findChild(root, 'sheetFormatPr')
  const properties = findChild(root, 'sheetPr')
  const tab = properties === undefined ? undefined : findChild(properties, 'tabColor')
  const filter = findChild(root, 'autoFilter')

  return {
    dimension: parseRange(attribute(dimension ?? {}, 'ref') ?? ''),
    view: readView(root),
    columns: readColumns(root),
    merges: readMerges(root),
    format: {
      defaultRowHeight: number(format, 'defaultRowHeight'),
      defaultColumnWidth: number(format, 'defaultColWidth'),
      customHeight: flag(format, 'customHeight', false),
    },
    tabColor: attribute(tab ?? {}, 'rgb') ?? null,
    autoFilter: readAutoFilter(filter),
    conditional: readConditionalFormats(root),
    protection: readProtection(root),
    validations: readValidationsIn(root),
    page: readPageSetupIn(root),
    sparklines: readSparklinesIn(root),
  }
}

/** The width of a column, or the sheet's default where it states none. */
export function widthOfColumn(sheet: Worksheet, column: number): number | null {
  const stated = sheet.columns.find((range) => column >= range.from && column <= range.to)
  return stated?.width ?? sheet.format.defaultColumnWidth
}

/** Whether a column is hidden, which a range of them can say at once. */
export const isColumnHidden = (sheet: Worksheet, column: number): boolean =>
  sheet.columns.some((range) => column >= range.from && column <= range.to && range.hidden)

/** The merge a cell belongs to, or null — which is most cells. */
export function mergeAt(sheet: Worksheet, cell: { row: number; column: number }): CellRange | null {
  return (
    sheet.merges.find(
      (range) =>
        cell.row >= range.from.row &&
        cell.row <= range.to.row &&
        cell.column >= range.from.column &&
        cell.column <= range.to.column,
    ) ?? null
  )
}
