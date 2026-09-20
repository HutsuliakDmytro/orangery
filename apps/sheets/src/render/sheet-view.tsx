import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DataGrid } from '@orangery/grid'
import type { CellAddress, CellStyle, Editing, GridRange, GridSelection } from '@orangery/grid'
import {
  cellAt,
  extentOf,
  formatCodeOf,
  highlightsOf,
  indexToColumn,
  linkCovering,
  mergeAt,
  resolveColor,
  resolveStyle,
  isColumnHidden,
  widthOfColumn,
} from '@orangery/ooxml-spreadsheet'
import type {
  AutoFilter,
  BorderEdge,
  Cell,
  CellHighlight,
  DifferentialFormat,
  Font,
  HighlightValue,
  ResolvedStyle,
  RichText,
  Styles,
  TextRun,
} from '@orangery/ooxml-spreadsheet'
import { formatValue } from '@orangery/numfmt'
import { iconOf } from './icon-sets'
import { SheetDrawings } from './sheet-drawings'
import { NoteBox } from './note-box'
import { notesOf } from './sheet-notes'
import { SuggestionList } from './suggestion-list'
import type { Suggested } from './suggestion-list'
import { chosen, functionsKnownSoFar, knownFunctions, shape, suggest } from '../document/suggest'
import type { KnownFunction } from '../document/suggest'
import { choicesOf, ruleAt } from '../document/validation'
import { isLocked } from '../document/protection'
import { editableText } from '../document/shown'
import type { OpenSheet, OpenWorkbook } from '../document/workbook'

/**
 * A worksheet, drawn.
 *
 * The seam between a file and a grid. Everything a workbook knows — the shared
 * strings, the style cascade, the theme, the format codes — is answered here,
 * one cell at a time, and the grid is handed strings and colours.
 *
 * Answered on demand rather than computed on open: a sheet has a million cells
 * and a window shows two hundred, and formatting the rest would be work for
 * something nobody will look at. What that costs is a lookup per visible cell
 * per repaint, which is why the expensive halves — the style cascade and the
 * format code — are cached by the index they came from.
 */

/** Excel counts widths in characters; a character is about seven points wide. */
const POINTS_PER_CHARACTER = 7
const DEFAULT_COLUMN_WIDTH = 8.43
const DEFAULT_ROW_HEIGHT = 15

export interface SheetViewProps {
  open: OpenWorkbook
  sheet: OpenSheet
  width: number
  height: number
  /** What is selected, which the name box outside the grid shows too. */
  selection?: GridSelection
  onSelectionChange?: (selection: GridSelection) => void
  /** Called with what was typed; without it the sheet is read-only. */
  onEdit?: (address: CellAddress, text: string) => void
  /** Called when Delete is pressed, with everything selected. */
  onClear?: () => void
  /** Called on `Mod+Enter`, to put one value into everything selected. */
  onFill?: (text: string) => void
  /** Called while a header edge is dragged, in points. */
  onResize?: (axis: 'row' | 'column', index: number, size: number) => void
  /** Called when a filter arrow is clicked, with the cell it sits on. */
  onFilterClick?: (cell: CellAddress) => void
  /** Called when a cell is clicked, which is how a link is followed. */
  onCellClick?: (cell: CellAddress) => void
  /** Called when the fill handle is dragged, with what and how far. */
  onFillSeries?: (from: GridRange, to: GridRange) => void
  /** The functions to offer, for a caller with its own list — a test. */
  functions?: readonly KnownFunction[]
}

export function SheetView({
  open,
  sheet,
  width,
  height,
  selection,
  onSelectionChange,
  onEdit,
  onClear,
  onFill,
  onResize,
  onFilterClick,
  onFillSeries,
  functions,
  onCellClick,
}: SheetViewProps) {
  const { styles, strings, palette } = open

  /**
   * The style a cell's index stands for, worked out once per index.
   *
   * A sheet of a hundred thousand cells has a dozen styles between them, and
   * following the cascade for each cell on every repaint would be the same
   * answer computed ten thousand times a second.
   */
  const resolved = useRef(new Map<number, ResolvedStyle>())

  // Emptied when the styles themselves change, and after an edit: typing a
  // percentage into a cell can add an entry, and an answer worked out before
  // it was added would be an answer about a style that no longer applies.
  useEffect(() => {
    resolved.current = new Map()
  }, [sheet.cells, styles])

  const styleOf = useCallback(
    (index: number | null): ResolvedStyle | null => {
      if (styles === null) return null

      const at = index ?? 0
      const held = resolved.current.get(at)
      if (held !== undefined) return held

      const made = resolveStyle(styles, at)
      resolved.current.set(at, made)
      return made
    },
    [styles],
  )

  const cellFor = useCallback(
    (address: CellAddress): Cell | null => cellAt(sheet.cells, address),
    [sheet.cells],
  )

  /**
   * What the sheet's conditional formatting makes of a cell.
   *
   * Null when the sheet has no rules, which is most sheets and is worth the
   * branch: everything below is skipped rather than answered with nothing.
   *
   * Cached by address because the grid asks twice for every visible cell —
   * once for the text, once for the look — and on a sheet nobody can edit yet
   * the answer cannot have changed in between.
   */
  const highlight = useMemo(() => {
    const rules = sheet.sheet.conditional
    if (rules.length === 0) return null

    const at = highlightsOf(rules, {
      valueAt: (position) => valueOfCell(cellAt(sheet.cells, position), strings),
      extent: extentOf(sheet.cells),
      palette,
    })

    const held = new Map<number, CellHighlight | null>()
    return (address: CellAddress): CellHighlight | null => {
      // One number for a position: sixteen thousand columns fit in fourteen
      // bits, and a string key per cell per repaint is garbage by the frame.
      const key = address.row * 16_384 + address.column
      const answer = held.get(key)
      if (answer !== undefined) return answer

      const made = at(address)
      held.set(key, made)
      return made
    }
  }, [palette, sheet.cells, sheet.sheet.conditional, strings])

  /**
   * `Mod+Enter`, with the selection dropped.
   *
   * The grid hands over what is selected because it is the grid that knows;
   * the store has the same selection already, and taking it twice would leave
   * two answers to one question.
   */
  const filled = useMemo(
    () =>
      onFill === undefined
        ? undefined
        : (_: GridSelection, text: string) => {
            onFill(text)
          },
    [onFill],
  )

  /** What has been said about the cells, indexed once for the whole sheet. */
  const notes = useMemo(() => notesOf(sheet.comments), [sheet.comments])

  /** The cell the pointer is over, which is what a note is shown beside. */
  const [hovered, setHovered] = useState<CellAddress | null>(null)

  /**
   * What a cell shows.
   *
   * The type says how to read the value — a shared string is an index into the
   * table, and reading it as a number is the classic way to show 4 where Q1
   * was meant — and the format says what to make of it.
   */
  const valueAt = useCallback(
    (address: CellAddress): string | null => {
      const cell = cellFor(address)
      if (cell === null || cell.value === null) return null

      if (cell.type === 's') {
        const index = Number(cell.value)
        return strings[index]?.text ?? ''
      }
      if (cell.type === 'inlineStr' || cell.type === 'str') return cell.value
      if (cell.type === 'e') return cell.value
      if (cell.type === 'b') return cell.value === '1' ? 'TRUE' : 'FALSE'

      const number = Number(cell.value)
      if (!Number.isFinite(number)) return cell.value

      const marks = highlight?.(address) ?? null

      // A bar or an icon can be asked to stand in for the number rather than
      // sit beside it, which is how a column of figures becomes a chart.
      if (marks?.bar?.showValue === false || marks?.icon?.showValue === false) return null

      const style = styleOf(cell.style)
      const ruled = styles === null || marks === null ? null : formatOf(styles, marks.formats)
      const code =
        ruled?.numberFormat ??
        (styles === null || style === null ? null : formatCodeOf(styles, style.numberFormat))

      return formatValue(number, code, { date1904: open.workbook.date1904 }).text
    },
    [cellFor, highlight, open.workbook.date1904, strings, styleOf, styles],
  )

  /**
   * What somebody edits when they open a cell.
   *
   * The formula, where there is one: a cell showing 42 that holds `=6*7` has
   * to open as `=6*7`, or the only way to change a formula would be to write
   * it out again from memory. Everything else opens as what it shows.
   */
  const editableAt = useCallback(
    (address: CellAddress): string | null => editableText(open, cellFor(address)),
    [cellFor, open],
  )

  const styleAt = useCallback(
    (address: CellAddress): CellStyle | null => {
      const cell = cellFor(address)
      const own = styleOf(cell?.style ?? null)
      if (own === null) return null

      const marks = highlight?.(address) ?? null
      const ruled = styles === null || marks === null ? null : formatOf(styles, marks.formats)
      const style = ruled === null ? own : overlaid(own, ruled)

      const hex = (color: Parameters<typeof resolveColor>[0]) => {
        const six = resolveColor(color, palette)
        return six === null ? undefined : `#${six}`
      }

      // A pattern of `none` is no fill at all, which is not a white one: the
      // cell shows whatever is behind it, and painting it white would hide the
      // gridlines under it.
      const fill = style.fill
      const painted =
        fill === null || fill.pattern === null || fill.pattern === 'none'
          ? undefined
          : hex(fill.foreground)

      /**
       * A colour scale, unless a rule named a colour of its own.
       *
       * Both are backgrounds and a cell has one. Which should win is a
       * question of the two rules' priorities; taking the stated colour over
       * the computed one is right whenever the rule stating it was written
       * later, which is where Excel puts a new rule.
       */
      const scale = marks?.scale ?? null
      const background = ruled?.fill == null && scale !== null ? `#${scale}` : painted

      const font = style.font

      /**
       * The pieces of a value that do not all look alike.
       *
       * A shared string carries them for most cells and an inline one for the
       * rest; either way they lie over the cell's own font, so a run that only
       * reddens its words keeps the size and the family of the cell it is in.
       */
      const pieces = runsOf(cell, strings)
      const runs =
        pieces === null
          ? undefined
          : pieces.map((run) => ({
              text: run.text,
              font: fontShorthand({ ...font, ...run.font }),
              color: hex(run.font.color ?? font?.color ?? null),
            }))

      /**
       * A link looks like a link.
       *
       * Blue and underlined unless the cell says otherwise, which is what
       * every program that has ever shown one does — and the only sign there
       * is, since a link is a rectangle in a list rather than anything the
       * cell itself carries.
       */
      const link = linkCovering(sheet.links, address)
      const linked =
        link === null
          ? {}
          : {
              color: hex(font?.color ?? null) ?? LINK_COLOR,
              underline: underlineOf(font?.underline ?? 'single'),
            }

      return {
        font: fontShorthand(font),
        // Lines a font shorthand cannot carry, which the grid draws itself.
        ...(font?.underline == null ? {} : { underline: underlineOf(font.underline) }),
        ...(font?.strike === true ? { strike: true } : {}),
        color: hex(font?.color ?? null),
        ...linked,
        background,
        runs,
        bar:
          marks?.bar === null || marks?.bar === undefined
            ? undefined
            : { color: `#${marks.bar.color}`, proportion: marks.bar.proportion },
        icon:
          marks?.icon === null || marks?.icon === undefined
            ? undefined
            : iconOf(marks.icon.set, marks.icon.index, marks.icon.count),
        align:
          style.alignment?.horizontal === 'center'
            ? 'center'
            : style.alignment?.horizontal === 'right'
              ? 'right'
              : style.alignment?.horizontal === 'left'
                ? 'left'
                : undefined,
        verticalAlign:
          style.alignment?.vertical === 'top'
            ? 'top'
            : style.alignment?.vertical === 'center'
              ? 'middle'
              : undefined,
        indent: style.alignment?.indent ?? 0,
        wrap: style.alignment?.wrapText ?? false,
        rotation: turnOf(style.alignment?.textRotation ?? null),
        // Purple for a thread and red for a note, as Excel marks them: the
        // two are different things and one of them can be replied to.
        corner: cornerOf(notes.at(address)),
        filter: filterArrow(sheet.sheet.autoFilter, address),
        borders: {
          left:
            hex(style.border.left.color) ?? (style.border.left.style === null ? null : '#B2B2B2'),
          right:
            hex(style.border.right.color) ?? (style.border.right.style === null ? null : '#B2B2B2'),
          top: hex(style.border.top.color) ?? (style.border.top.style === null ? null : '#B2B2B2'),
          bottom:
            hex(style.border.bottom.color) ??
            (style.border.bottom.style === null ? null : '#B2B2B2'),
        },
      }
    },
    [
      cellFor,
      highlight,
      notes,
      palette,
      sheet.links,
      sheet.sheet.autoFilter,
      strings,
      styleOf,
      styles,
    ],
  )

  const merged = useCallback(
    (address: CellAddress) => {
      const range = mergeAt(sheet.sheet, address)
      if (range === null) return null

      return {
        cell: { row: range.from.row, column: range.from.column },
        rows: range.to.row - range.from.row + 1,
        columns: range.to.column - range.from.column + 1,
      }
    },
    [sheet.sheet],
  )

  /**
   * As far as the cells reach, with room to scroll past them as Excel has —
   * and as far as the selection reaches, which can be further.
   *
   * A reference typed into the name box names a cell the sheet may never have
   * had, and a grid that stopped short of it would refuse to go where it had
   * just been told to go.
   */
  const extent = useMemo(() => {
    const rows = Math.max(...[...sheet.cells.rows.keys()].map((row) => row + 1), 0)
    const columns = Math.max(
      ...[...sheet.cells.rows.values()].flatMap((cells) => [...cells.keys()].map((one) => one + 1)),
      0,
    )

    const reach = (selection?.ranges ?? []).reduce(
      (far, range) => ({
        rows: Math.max(far.rows, range.anchor.row + 1, range.focus.row + 1),
        columns: Math.max(far.columns, range.anchor.column + 1, range.focus.column + 1),
      }),
      { rows: 0, columns: 0 },
    )

    return {
      rows: Math.max(rows + 50, 100, reach.rows),
      columns: Math.max(columns + 5, 26, reach.columns),
    }
  }, [selection, sheet.cells])

  const metrics = useMemo(() => {
    // A hidden column is one of no width. The grid needs no notion of hiding
    // for that to work: everything it measures, hit-tests and scrolls past
    // comes out right because the column is genuinely nought wide.
    const widths = Array.from({ length: extent.columns }, (_, column) => {
      if (isColumnHidden(sheet.sheet, column)) return 0

      const stated = widthOfColumn(sheet.sheet, column) ?? DEFAULT_COLUMN_WIDTH
      return Math.round(stated * POINTS_PER_CHARACTER)
    })

    return {
      columnWidth: Math.round(DEFAULT_COLUMN_WIDTH * POINTS_PER_CHARACTER),
      columnWidths: widths,
      rowHeight: Math.round(sheet.sheet.format.defaultRowHeight ?? DEFAULT_ROW_HEIGHT) + 5,
      rowHeights: rowHeights(sheet),
      headerWidth: 44,
      headerHeight: 22,
    }
  }, [extent.columns, sheet])

  /**
   * The sheet's own zoom, as a factor.
   *
   * A workbook remembers the zoom each sheet was left at, and opening one at
   * 100 % when it was saved at 60 % shows a different sheet from the one
   * somebody put away.
   */
  const zoom = useMemo(() => {
    const stated = sheet.sheet.view.zoom
    return stated > 0 ? stated / 100 : 1
  }, [sheet.sheet.view.zoom])

  /**
   * The functions to offer while a formula is being typed into a cell.
   *
   * The grid owns the editor and says what is in it (`onEditing`); what to
   * make of that is a spreadsheet's business and so is here. The formula bar
   * asks the same question from another keyboard, and both go through the
   * same `suggest`.
   */
  const [editing, setEditing] = useState<Editing | null>(null)
  const [highlighted, setHighlighted] = useState(0)

  useEffect(() => {
    void knownFunctions()
  }, [])

  const offered = useMemo(() => {
    if (editing === null) return null
    return suggest(editing.text, editing.caret, functions ?? functionsKnownSoFar())
  }, [editing, functions])

  /**
   * The values a cell is allowed to hold, where somebody has said.
   *
   * A list rule is the other thing worth offering while a cell is being
   * edited, and it comes first: a cell with a dropdown on it is a cell where
   * the answer is one of those, whatever else the letters could become.
   */
  const choices = useMemo(() => {
    if (editing === null) return []

    const rule = ruleAt(sheet, editing.cell)
    if (rule === null || rule.kind !== 'list') return []

    const typed = editing.text.trim().toLowerCase()
    return choicesOf(open, sheet, rule).filter(
      (one) => typed === '' || one.toLowerCase().startsWith(typed),
    )
  }, [editing, open, sheet])

  const matches = offered?.matches ?? []
  const items: Suggested[] =
    choices.length > 0
      ? choices.map((one) => ({ value: one }))
      : matches.map((one) => ({ value: one.name, hint: shape(one) }))
  const picked = Math.min(highlighted, Math.max(items.length - 1, 0))

  /**
   * What taking one does.
   *
   * A choice replaces the cell; a function goes in where the name was being
   * typed. Neither commits — Enter and looking elsewhere still do that, as
   * they do for anything else typed into a cell.
   */
  const take = useCallback(
    (value: string) => {
      if (editing === null) return

      if (choices.length > 0) {
        editing.replace(value, value.length)
      } else if (offered !== null) {
        const made = chosen(editing.text, offered, value)
        editing.replace(made.text, made.caret)
      }

      setHighlighted(0)
    },
    [choices.length, editing, offered],
  )

  const frozen = useMemo(() => {
    const panes = sheet.sheet.view.panes
    // A split moves both panes and is not a freeze; nothing here holds rows
    // still for it, so it is drawn as an ordinary sheet until it is.
    return panes === null || panes.split ? null : { rows: panes.rows, columns: panes.columns }
  }, [sheet.sheet.view.panes])

  return (
    <div style={{ position: 'relative' }}>
      <DataGrid
        label={sheet.name}
        rows={extent.rows}
        columns={extent.columns}
        width={width}
        height={height}
        metrics={metrics}
        frozen={frozen}
        gridLines={sheet.sheet.view.showGridLines}
        zoom={zoom}
        {...(selection === undefined ? {} : { selection })}
        {...(onSelectionChange === undefined ? {} : { onSelectionChange })}
        {...(onEdit === undefined ? {} : { onChange: onEdit })}
        {...(onClear === undefined ? {} : { onDelete: onClear })}
        {...(filled === undefined ? {} : { onFill: filled })}
        {...(onResize === undefined ? {} : { onResize })}
        {...(onFilterClick === undefined ? {} : { onFilterClick })}
        {...(onFillSeries === undefined ? {} : { onFillSeries })}
        {...(onCellClick === undefined ? {} : { onCellClick })}
        onHoverCell={notes.any ? setHovered : undefined}
        overlay={
          sheet.drawings.length === 0 && !notes.any
            ? undefined
            : (view) => (
                <>
                  <SheetDrawings
                    open={open}
                    sheet={sheet}
                    metrics={view.metrics}
                    scrollX={view.scrollX}
                    scrollY={view.scrollY}
                    zoom={zoom}
                  />
                  <NoteBox
                    note={hovered === null ? null : notes.at(hovered)}
                    cell={hovered}
                    metrics={view.metrics}
                    scrollX={view.scrollX}
                    scrollY={view.scrollY}
                  />
                </>
              )
        }
        columnHeader={(column) => indexToColumn(column)}
        rowHeader={(row) => String(row + 1)}
        valueAt={valueAt}
        editableAt={editableAt}
        styleAt={styleAt}
        mergeAt={merged}
        editable={(cell) => !isLocked(open, sheet, cell)}
        onEditing={setEditing}
        onEditingKey={(event) => {
          if (items.length === 0) return false

          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            const step = event.key === 'ArrowDown' ? 1 : items.length - 1
            setHighlighted((was) => (was + step) % items.length)
            return true
          }

          if (event.key === 'Enter' || event.key === 'Tab') {
            const value = items[picked]?.value
            if (value === undefined) return false

            take(value)
            return true
          }

          // Escape closes the list and leaves the cell being edited, which is
          // one Escape more than a cell without a list needs.
          if (event.key === 'Escape') {
            setEditing(null)
            return true
          }

          return false
        }}
      />

      {editing !== null && items.length > 0 && (
        <SuggestionList
          label={choices.length > 0 ? 'Choices' : 'Functions'}
          items={items}
          highlighted={picked}
          onChoose={take}
          onHighlight={setHighlighted}
          style={{
            position: 'absolute',
            left: editing.rect.x,
            top: editing.rect.y + editing.rect.height,
          }}
        />
      )}
    </div>
  )
}

/**
 * The heights a sheet states for its rows, as the grid counts them.
 *
 * A hidden row is one of no height, for the same reason a hidden column is one
 * of no width: everything the grid measures and hit-tests then comes out right
 * without the grid knowing what hiding is.
 */
function rowHeights(sheet: OpenSheet): number[] {
  const stated = [...sheet.cells.properties.entries()].filter(
    ([, row]) => row.height !== null || row.hidden,
  )
  if (stated.length === 0) return []

  const last = Math.max(...stated.map(([index]) => index))
  const fallback = Math.round(sheet.sheet.format.defaultRowHeight ?? DEFAULT_ROW_HEIGHT) + 5

  return Array.from({ length: last + 1 }, (_, index) => {
    const row = sheet.cells.properties.get(index)
    if (row?.hidden === true) return 0

    const height = row?.height
    return height === null || height === undefined ? fallback : Math.round(height) + 5
  })
}

/**
 * A font as a canvas takes one.
 *
 * Weight and slant and nothing else: a canvas shorthand has no room for an
 * underline or a strikethrough. Those are lines rather than letters, and the
 * grid draws them from `underline` and `strike` beside the font.
 */
/**
 * Excel's four underlines as the two a renderer can draw.
 *
 * `singleAccounting` and `doubleAccounting` differ in where the line sits —
 * under the whole cell rather than under the letters — which is a detail of
 * the box, not of the text.
 */
/** The blue every program has shown a link in since 1993. */
const LINK_COLOR = '#0563C1'

const underlineOf = (stated: string): 'single' | 'double' =>
  stated === 'double' || stated === 'doubleAccounting' ? 'double' : 'single'

function fontShorthand(font: Partial<Font> | null | undefined): string {
  const size = font?.size ?? 11

  return (
    (font?.italic === true ? 'italic ' : '') +
    (font?.bold === true ? 'bold ' : '') +
    `${String(size)}px ${familiesFor(font?.name ?? 'Calibri')}`
  )
}

/**
 * What a font name is actually drawn with.
 *
 * A cell says `Calibri` whether or not Calibri is installed, so the name is
 * followed by the metric-compatible family the suite ships (`packages/fonts`)
 * and then by a generic. Without the chain a file written on Windows opens on
 * a Mac in whatever the browser falls back to, with every column the wrong
 * width for its contents.
 */
const STAND_INS: Readonly<Record<string, string>> = {
  Calibri: 'Carlito',
  Arial: 'Liberation Sans',
  Helvetica: 'Liberation Sans',
  'Times New Roman': 'Liberation Serif',
  'Courier New': 'Liberation Mono',
  Cambria: 'Liberation Serif',
}

function familiesFor(name: string): string {
  const quoted = name.includes(' ') ? `"${name}"` : name
  const standIn = STAND_INS[name]
  const generic = /mono|courier|consol/iu.test(name)
    ? 'monospace'
    : /times|serif|georgia|cambria|garamond/iu.test(name)
      ? 'serif'
      : 'sans-serif'

  return standIn === undefined ? `${quoted}, ${generic}` : `${quoted}, "${standIn}", ${generic}`
}

/** The runs a cell's value is made of, or null where it is all one piece. */
function runsOf(cell: Cell | null, strings: readonly RichText[]): TextRun[] | null {
  if (cell === null) return null
  if (cell.type === 's') return strings[Number(cell.value)]?.runs ?? null

  return cell.type === 'inlineStr' ? (cell.rich?.runs ?? null) : null
}

/**
 * Whether a cell carries a filter arrow, and whether that column is filtering.
 *
 * The arrows sit on the top row of the filter's range, which is the header:
 * that is where Excel puts them and where a person looks for them.
 */
function filterArrow(filter: AutoFilter | null, address: CellAddress): { on: boolean } | undefined {
  if (filter === null) return undefined

  const top = Math.min(filter.range.from.row, filter.range.to.row)
  const left = Math.min(filter.range.from.column, filter.range.to.column)
  const right = Math.max(filter.range.from.column, filter.range.to.column)
  if (address.row !== top || address.column < left || address.column > right) return undefined

  return { on: filter.columns.some((one) => one.column === address.column - left) }
}

/** The colour of the mark on a cell with something said about it. */
function cornerOf(note: ReturnType<ReturnType<typeof notesOf>['at']>): string | undefined {
  if (note === null) return undefined
  // A resolved thread is still there and is no longer waiting for anybody; a
  // quieter mark says so without taking it away.
  if (note.resolved) return '#B0B0B0'

  return note.kind === 'thread' ? '#7B4FA8' : '#C00000'
}

/**
 * How far a cell's text is turned, in the grid's terms.
 *
 * The file counts in one direction up to ninety and then starts again in the
 * other: 1 to 90 is anticlockwise, and 91 to 180 is one to ninety degrees
 * clockwise with ninety added. 255 is not an angle at all — it is Excel's word
 * for letters stood one under another, each still the right way up.
 */
function turnOf(rotation: number | null): number | 'stacked' | undefined {
  if (rotation === null || rotation === 0) return undefined
  if (rotation === 255) return 'stacked'
  if (rotation > 90 && rotation <= 180) return -(rotation - 90)

  return rotation
}

/**
 * What a cell holds, as a conditional rule asks about it.
 *
 * The rules compare numbers with numbers and words with words, so the two are
 * told apart here and not inside the rule. A formula's cached result counts as
 * whatever it is: the file states the answer, and a rule about that column
 * means the answers rather than the formulas.
 */
function valueOfCell(cell: Cell | null, strings: readonly RichText[]): HighlightValue | null {
  if (cell === null || cell.value === null) return null

  if (cell.type === 's') {
    const text = strings[Number(cell.value)]?.text ?? ''
    return text === '' ? null : { number: null, text, error: false }
  }
  if (cell.type === 'inlineStr' || cell.type === 'str') {
    return cell.value === '' ? null : { number: null, text: cell.value, error: false }
  }
  if (cell.type === 'e') return { number: null, text: cell.value, error: true }
  if (cell.type === 'b') {
    return { number: null, text: cell.value === '1' ? 'TRUE' : 'FALSE', error: false }
  }

  const number = Number(cell.value)
  return Number.isFinite(number)
    ? { number, text: cell.value, error: false }
    : { number: null, text: cell.value, error: false }
}

/**
 * The formats of every rule that matched, as one.
 *
 * The list arrives most important first; merged the other way round, so that
 * the most important rule is the last to have its say. A rule states only what
 * it changes, so two rules can both be honoured — the bold of one and the fill
 * of the other — which is what Excel does.
 */
function formatOf(styles: Styles, ids: readonly number[]): DifferentialFormat | null {
  if (ids.length === 0) return null

  const merged: DifferentialFormat = { font: null, fill: null, border: null, numberFormat: null }
  let any = false

  for (const id of [...ids].reverse()) {
    const format = styles.differential[id]
    if (format === undefined) continue

    any = true
    if (format.font !== null) merged.font = { ...merged.font, ...format.font }
    if (format.fill !== null) merged.fill = format.fill
    if (format.border !== null) merged.border = format.border
    if (format.numberFormat !== null) merged.numberFormat = format.numberFormat
  }

  return any ? merged : null
}

/** A cell's own look with a rule's laid over it, part by part. */
function overlaid(own: ResolvedStyle, ruled: DifferentialFormat): ResolvedStyle {
  const edge = (mine: BorderEdge, theirs: BorderEdge | undefined): BorderEdge =>
    theirs === undefined || theirs.style === null ? mine : theirs

  return {
    ...own,
    font: ruled.font === null ? own.font : { ...(own.font ?? BARE_FONT), ...ruled.font },
    /**
     * A rule's colour is in `bgColor`, not `fgColor`.
     *
     * The classic "light red fill with dark red text" is written by Excel as a
     * `patternFill` with only a `bgColor`, and a reader that looked where a
     * cell's own fill keeps its colour would find nothing and paint nothing.
     */
    fill:
      ruled.fill === null
        ? own.fill
        : {
            pattern: 'solid',
            foreground: ruled.fill.background ?? ruled.fill.foreground,
            background: null,
            gradient: false,
          },
    border:
      ruled.border === null
        ? own.border
        : {
            ...own.border,
            left: edge(own.border.left, ruled.border.left),
            right: edge(own.border.right, ruled.border.right),
            top: edge(own.border.top, ruled.border.top),
            bottom: edge(own.border.bottom, ruled.border.bottom),
          },
  }
}

/** What a rule's font is laid over when the cell itself states none. */
const BARE_FONT: Font = {
  name: null,
  size: null,
  bold: false,
  italic: false,
  underline: null,
  strike: false,
  color: null,
  vertAlign: null,
  scheme: null,
}
