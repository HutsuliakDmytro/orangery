import { parseReference } from './reference'
import type { CellPosition, CellRange } from './reference'
import type { RichText } from './rich-text'

/**
 * What a cell is, in the model the whole app hangs off.
 *
 * Sparse, and deliberately close to the file: a sheet is ten million cells of
 * which a few thousand exist, and every conversion away from what `sheetData`
 * says is a conversion that has to be undone on save. Values stay in the form
 * the file states them — a date is a number, because that is what it is — and
 * the type says how to read it.
 *
 * `carried` is the ADR's rule about attributes nobody here understands
 * (`apps/sheets/docs/adr/0002-xlsx-roundtrip.md`): `cm` and `vm` are what a
 * dynamic array is recognised by and `ph` is a Japanese reading, and a cell
 * that dropped them would lose something invisible on the first save.
 */

/** `n` numbers, `s` shared strings, `str` formula strings, `b` booleans, `e` errors. */
export type CellType = 'n' | 's' | 'str' | 'b' | 'e' | 'inlineStr' | 'd'

export type FormulaKind = 'normal' | 'shared' | 'array' | 'dataTable'

export interface Formula {
  /** As written, in the file's own A1 form; never localised. */
  text: string
  kind: FormulaKind
  /** The group a shared formula belongs to. */
  shared: number | null
  /** The range an array formula spills over, or a shared group covers. */
  ref: string | null
}

export interface Cell {
  row: number
  column: number
  type: CellType
  /**
   * The `<v>` as text, or the words of an inline string.
   *
   * Left as text on purpose: `0.1 + 0.2` is a question for the formula engine,
   * and a reader that parsed every cell into a double would hand the engine a
   * number the file never stated.
   */
  value: string | null
  /** Into `cellXfs`; null for a cell that states none, which means the first. */
  style: number | null
  formula: Formula | null
  /**
   * The runs of an inline string whose words are not all alike.
   *
   * Null for the ordinary cell, which is nearly all of them: a cell has one
   * style and needs no runs to say so. A cell that is half bold is one where
   * the string itself carries the formatting (`rich-text.ts`).
   */
  rich: RichText | null
  /** Attributes this does not model, kept so they survive a save. */
  carried: Record<string, string> | null
}

export interface RowProperties {
  index: number
  /** In points, as the file states it. */
  height: number | null
  customHeight: boolean
  hidden: boolean
  outlineLevel: number | null
  /** A style for the whole row, which cells inherit when they state none. */
  style: number | null
  collapsed: boolean
  /**
   * `spans` is carried rather than modelled: it says which columns a row
   * holds, which the cells already say, and Excel recomputes it.
   */
  carried: Record<string, string> | null
}

/**
 * A sheet's cells, by row and then by column.
 *
 * Two maps rather than one keyed by `"B2"`: the grid asks "what is in the rows
 * I can see" thousands of times a second while scrolling, and a flat map makes
 * that a scan of the whole sheet.
 */
export interface SheetCells {
  rows: Map<number, Map<number, Cell>>
  properties: Map<number, RowProperties>
}

export const emptySheet = (): SheetCells => ({ rows: new Map(), properties: new Map() })

export function cellAt(sheet: SheetCells, position: CellPosition): Cell | null {
  return sheet.rows.get(position.row)?.get(position.column) ?? null
}

export function putCell(sheet: SheetCells, cell: Cell): void {
  const row = sheet.rows.get(cell.row) ?? new Map<number, Cell>()
  row.set(cell.column, cell)
  sheet.rows.set(cell.row, row)
}

/** Every cell of a row, left to right. */
export function cellsOfRow(sheet: SheetCells, row: number): Cell[] {
  const cells = sheet.rows.get(row)
  return cells === undefined ? [] : [...cells.values()].sort((a, b) => a.column - b.column)
}

/** The rows that hold anything, in order. A sheet is mostly nothing. */
export const rowsWithCells = (sheet: SheetCells): number[] =>
  [...sheet.rows.keys()].sort((a, b) => a - b)

/** How far the cells reach, which is not what `dimension` claims. */
export function extentOf(sheet: SheetCells): { rows: number; columns: number } {
  let rows = 0
  let columns = 0

  for (const [index, cells] of sheet.rows) {
    rows = Math.max(rows, index + 1)
    for (const column of cells.keys()) columns = Math.max(columns, column + 1)
  }

  return { rows, columns }
}

/** The position a cell states, for a reader that has the reference and not the parts. */
export const positionOf = (reference: string): CellPosition | null => parseReference(reference)

/**
 * The block of filled cells a cell belongs to.
 *
 * What a spreadsheet means by "this table" when you have clicked one cell of
 * it and asked to sort: grow outwards while the next row or column still has
 * something in it, and stop at the first empty one. A blank row is what
 * everybody uses to mean "and here is a different table", so it is what this
 * stops at.
 *
 * A cell with nothing around it is a region of itself.
 */
export function regionAround(sheet: SheetCells, from: CellPosition): CellRange {
  const filled = (row: number, column: number): boolean => {
    const cell = cellAt(sheet, { row, column })
    return cell !== null && cell.value !== null && cell.value !== ''
  }

  let top = from.row
  let bottom = from.row
  let left = from.column
  let right = from.column

  const anyInRow = (row: number) => {
    for (let column = left; column <= right; column += 1) if (filled(row, column)) return true
    return false
  }
  const anyInColumn = (column: number) => {
    for (let row = top; row <= bottom; row += 1) if (filled(row, column)) return true
    return false
  }

  // Alternated rather than done once each: a table found one row at a time is
  // wider by the end, and a column that only touches the rows found later
  // would be missed by a single pass.
  let growing = true
  while (growing) {
    growing = false

    if (top > 0 && anyInRow(top - 1)) {
      top -= 1
      growing = true
    }
    if (anyInRow(bottom + 1)) {
      bottom += 1
      growing = true
    }
    if (left > 0 && anyInColumn(left - 1)) {
      left -= 1
      growing = true
    }
    if (anyInColumn(right + 1)) {
      right += 1
      growing = true
    }
  }

  return { sheet: null, from: { row: top, column: left }, to: { row: bottom, column: right } }
}
