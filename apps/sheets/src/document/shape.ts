import {
  adjustFormula,
  movedIndex,
  movedPosition,
  movedRange,
  movedRanges,
} from '@orangery/ooxml-spreadsheet'
import type {
  AutoFilter,
  BandChange,
  CellRange,
  ColumnRange,
  ConditionalFormat,
  DataValidation,
  FormulaPlace,
  Hyperlink,
  SparklineGroup,
  Table,
  TableColumn,
} from '@orangery/ooxml-spreadsheet'
import type { OpenSheet } from './workbook'

/**
 * A sheet's shape, and what an insertion does to it.
 *
 * The cells are the obvious half of putting a row in and the smaller half.
 * A sheet also holds a dozen rectangles that are not cells — the merges, the
 * conditional rules, the validations, the filter, the links, the tables, the
 * little charts — and none of them move because a cell did. A sheet that
 * shifted only its cells comes back with its colours on the wrong rows and
 * its table one row short, which is the kind of wrong that is not noticed
 * until somebody else opens the file.
 *
 * Rectangles move by the rule in `movedRange`; formulas by `adjustFormula`,
 * which several of these carry (a rule can be `=$A2>TODAY()`, a validation
 * can be `=$H$1:$H$9`, a table column can be calculated).
 */

/**
 * Everything on a sheet that is a rectangle rather than a cell.
 *
 * Kept as one snapshot because one event changes all of it at once: rows go
 * in, and the merges, the rules, the validations, the filter, the links, the
 * tables and the little charts all move together or none of them do. A
 * history that recorded seven lists would be a history where six of them
 * could come back without the seventh.
 */
export interface SheetShape {
  columns: ColumnRange[]
  merges: CellRange[]
  filter: AutoFilter | null
  conditional: ConditionalFormat[]
  validations: DataValidation[]
  sparklines: SparklineGroup[]
  links: Hyperlink[]
  tables: Table[]
}

export const shapeOf = (sheet: OpenSheet): SheetShape => ({
  columns: sheet.sheet.columns,
  merges: sheet.sheet.merges,
  filter: sheet.sheet.autoFilter,
  conditional: sheet.sheet.conditional,
  validations: sheet.sheet.validations,
  sparklines: sheet.sheet.sparklines,
  links: sheet.links,
  tables: sheet.tables,
})

export function putShape(sheet: OpenSheet, shape: SheetShape): void {
  sheet.sheet.columns = shape.columns
  sheet.sheet.merges = shape.merges
  sheet.sheet.autoFilter = shape.filter
  sheet.sheet.conditional = shape.conditional
  sheet.sheet.validations = shape.validations
  sheet.sheet.sparklines = shape.sparklines
  sheet.links = shape.links
  sheet.tables = shape.tables
}

/** A run of columns, which is a rectangle one row tall on the other axis. */
function movedRun(run: ColumnRange, change: BandChange): ColumnRange | null {
  if (change.axis !== 'column') return run

  const moved = movedRange(
    { sheet: null, from: { row: 0, column: run.from }, to: { row: 0, column: run.to } },
    change,
  )
  if (moved === null) return null

  return { ...run, from: moved.from.column, to: moved.to.column }
}

/**
 * The filter, with its criteria still on the columns they were about.
 *
 * A criterion names its column by how far it is from the left of the filter's
 * own range, not by where it is on the sheet. So inserting a column inside
 * the range moves every criterion to its right by one, and the arithmetic has
 * to go through the sheet's own numbering to find that out.
 */
function movedFilter(filter: AutoFilter | null, change: BandChange): AutoFilter | null {
  if (filter === null) return null

  const range = movedRange(filter.range, change)
  if (range === null) return null
  if (change.axis !== 'column') return { ...filter, range }

  const left = Math.min(filter.range.from.column, filter.range.to.column)
  const width = Math.abs(range.to.column - range.from.column) + 1

  const columns = filter.columns.flatMap((column) => {
    const moved = movedIndex(left + column.column, change)
    if (moved === null) return []

    const at = moved - Math.min(range.from.column, range.to.column)
    return at >= 0 && at < width ? [{ ...column, column: at }] : []
  })

  return { ...filter, range, columns }
}

/** A rule block, gone when none of the cells it covered are left. */
function movedConditional(
  format: ConditionalFormat,
  change: BandChange,
  place: FormulaPlace,
): ConditionalFormat | null {
  const ranges = movedRanges(format.ranges, change)
  if (ranges.length === 0) return null

  return {
    ranges,
    // A rule can be a formula — `=$A2>TODAY()` — and it is about cells like
    // any other formula.
    rules: format.rules.map((rule) => ({
      ...rule,
      formulas: rule.formulas.map((text) => adjustFormula(text, change, place)),
    })),
  }
}

/** A validation, whose operands can name cells as readily as a rule's. */
function movedValidation(
  validation: DataValidation,
  change: BandChange,
  place: FormulaPlace,
): DataValidation | null {
  const ranges = movedRanges(validation.ranges, change)
  if (ranges.length === 0) return null

  const operand = (text: string | null): string | null =>
    text === null ? null : adjustFormula(text, change, place)

  return {
    ...validation,
    ranges,
    formula1: operand(validation.formula1),
    formula2: operand(validation.formula2),
  }
}

/**
 * A table, and the columns it must go on having exactly as many of.
 *
 * The range and the column list are two statements of the same width, and a
 * file where they disagree is one Excel offers to repair. So a column put
 * inside a table adds a column to the table, and one taken out of it takes
 * one away — which is also what Excel does, and what somebody means by
 * inserting a column into a table.
 */
function movedTable(table: Table, change: BandChange, place: FormulaPlace): Table | null {
  const range = movedRange(table.range, change)
  if (range === null) return null

  const height = Math.abs(range.to.row - range.from.row) + 1
  const headerRows = Math.min(table.headerRows, height)
  const totalsRows = Math.min(table.totalsRows, height - headerRows)

  const adjusted = table.columns.map((column) => ({
    ...column,
    formula: column.formula === null ? null : adjustFormula(column.formula, change, place),
  }))

  const columns =
    change.axis === 'column' ? tableColumns({ ...table, columns: adjusted }, change) : adjusted

  return { ...table, range, headerRows, totalsRows, columns }
}

/** The column list, with as many added or dropped as the sheet gained or lost. */
function tableColumns(table: Table, change: BandChange): TableColumn[] {
  const left = Math.min(table.range.from.column, table.range.to.column)
  const right = Math.max(table.range.from.column, table.range.to.column)

  // Entirely to one side: the table moved, and its columns are its columns.
  if (change.at > right) return table.columns
  if (change.by > 0 && change.at <= left) return table.columns
  if (change.by < 0 && change.at - change.by <= left) return table.columns

  const taken = new Set(table.columns.map((one) => one.name))
  const free = (): string => {
    let at = 1
    while (taken.has(`Column${String(at)}`)) at += 1
    taken.add(`Column${String(at)}`)
    return `Column${String(at)}`
  }

  const ids = table.columns.map((one) => Number(one.id)).filter((one) => Number.isFinite(one))
  let nextId = Math.max(0, ...ids) + 1

  const at = change.at - left

  if (change.by > 0) {
    const added = Array.from({ length: change.by }, (): TableColumn => {
      const id = String(nextId)
      nextId += 1
      return { name: free(), id, totalsFunction: null, totalsLabel: null, formula: null }
    })

    return [...table.columns.slice(0, at), ...added, ...table.columns.slice(at)]
  }

  return [...table.columns.slice(0, Math.max(0, at)), ...table.columns.slice(at - change.by)]
}

/**
 * The little charts, moved with the cells they are drawn in and drawn from.
 *
 * Only in the model: a sparkline lives in the worksheet's `<extLst>`, which
 * is carried through a save exactly as it arrived. So this keeps the screen
 * honest and the file says what it said — the same bargain every unmodelled
 * part of a workbook is under.
 */
function movedSparklines(
  groups: readonly SparklineGroup[],
  change: BandChange,
  place: FormulaPlace,
): SparklineGroup[] {
  return groups.flatMap((group) => {
    const sparklines = group.sparklines.flatMap((one) => {
      const cell = movedPosition(one.cell, change)
      if (cell === null) return []

      return [{ cell, formula: adjustFormula(one.formula, change, place) }]
    })

    return sparklines.length === 0 ? [] : [{ ...group, sparklines }]
  })
}

/** The sheet's rectangles, all of them, after the change. */
export function movedShape(shape: SheetShape, change: BandChange, place: FormulaPlace): SheetShape {
  return {
    columns: shape.columns.flatMap((run) => {
      const moved = movedRun(run, change)
      return moved === null ? [] : [moved]
    }),
    merges: movedRanges(shape.merges, change),
    filter: movedFilter(shape.filter, change),
    conditional: shape.conditional.flatMap((format) => {
      const moved = movedConditional(format, change, place)
      return moved === null ? [] : [moved]
    }),
    validations: shape.validations.flatMap((validation) => {
      const moved = movedValidation(validation, change, place)
      return moved === null ? [] : [moved]
    }),
    sparklines: movedSparklines(shape.sparklines, change, place),
    links: shape.links.flatMap((link) => {
      const moved = movedRange(link.range, change)
      return moved === null ? [] : [{ ...link, range: moved }]
    }),
    tables: shape.tables.flatMap((table) => {
      const moved = movedTable(table, change, place)
      return moved === null ? [] : [moved]
    }),
  }
}

/** Whether the same range, by what it covers rather than by which object it is. */
const sameRange = (a: CellRange, b: CellRange): boolean =>
  a.from.row === b.from.row &&
  a.from.column === b.from.column &&
  a.to.row === b.to.row &&
  a.to.column === b.to.column

/**
 * Whether the tables are not where they were.
 *
 * Asked because moving a table costs more than moving the rest of a shape: a
 * table is a part of its own that has to be written, and the formula engine
 * was told where every table is and has no other way of finding out that one
 * moved. Neither is worth doing for a sheet whose tables did not move.
 */
export const tablesMoved = (before: SheetShape, after: SheetShape): boolean =>
  before.tables.length !== after.tables.length ||
  before.tables.some((table, at) => {
    const now = after.tables[at]
    return (
      now === undefined ||
      !sameRange(table.range, now.range) ||
      table.columns.length !== now.columns.length
    )
  })
