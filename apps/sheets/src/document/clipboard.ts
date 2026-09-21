import {
  blockFromHtml,
  blockFromText,
  blockOf,
  blockToHtml,
  blockToText,
  putCell,
  sameSession,
  shiftFormula,
} from '@orangery/ooxml-spreadsheet'
import type { Cell, CellBlock } from '@orangery/ooxml-spreadsheet'
import { boundsOf } from '@orangery/grid'
import type { GridSelection } from '@orangery/grid'
import type { CellChange } from './edit'
import type { OpenSheet } from './workbook'

/**
 * Copying cells out, and putting them back.
 *
 * What goes on the clipboard is the same cells in three forms at once — the
 * model for this app, a table for a browser, tab-separated text for everything
 * else — and what comes back is the richest of them that survived the journey.
 *
 * Only the last range of a selection is copied. Excel refuses a copy of
 * several ranges that are not the same shape, and the rectangle somebody
 * chose last is the one they were looking at; the alternative is guessing how
 * to lay out an L.
 */

/** The rectangle a copy or a paste works on. */
export function copiedRange(
  selection: GridSelection,
): CellBlock['origin'] & { to: CellBlock['origin'] } {
  const last = selection.ranges[selection.ranges.length - 1]
  const range = last ?? { anchor: selection.active, focus: selection.active }
  const bounds = boundsOf(range)

  return { row: bounds.top, column: bounds.left, to: { row: bounds.bottom, column: bounds.right } }
}

export interface Copied {
  html: string
  text: string
}

/** The selection as the three things a clipboard should carry. */
export function copiedFrom(
  sheet: OpenSheet,
  selection: GridSelection,
  shown: (cell: Cell | null) => string,
): Copied {
  const range = copiedRange(selection)
  const block = blockOf(sheet.cells, {
    sheet: null,
    from: { row: range.row, column: range.column },
    to: range.to,
  })

  return { html: blockToHtml(block, shown), text: blockToText(block, shown) }
}

/**
 * The block a clipboard is holding.
 *
 * The HTML first, because it is the only one of the two that can be ours. Text
 * is the fallback and always readable, which is the point of putting it there.
 */
export function blockFrom(
  clipboard: { html: string | null; text: string | null },
  at: CellBlock['origin'],
): CellBlock | null {
  const own = clipboard.html === null ? null : blockFromHtml(clipboard.html)
  if (own !== null) return own

  return clipboard.text === null || clipboard.text === '' ? null : blockFromText(clipboard.text, at)
}

/**
 * What of a copied cell actually arrives, and in what shape.
 *
 * The three questions every spreadsheet's Paste Special asks, and they are
 * separate because people want them separately: numbers without the formulas
 * that made them, a look without the values wearing it, a column turned into
 * a row.
 */
export interface PasteOptions {
  /** `values` drops the formulas, `formats` brings nothing but the look. */
  what: 'all' | 'values' | 'formats'
  /** Rows become columns, which is a different block rather than a flag. */
  transpose: boolean
  /**
   * The rectangle somebody selected, where it is bigger than the block.
   *
   * A block laid into a selection that is a whole multiple of it is laid down
   * as many times as it goes — one row copied across a week, a fortnight of
   * columns filled from a fortnight's worth. Anything that is not a whole
   * multiple is pasted once at the corner, because half a block is not
   * something anybody meant.
   */
  over?: { rows: number; columns: number }
}

const ORDINARY: PasteOptions = { what: 'all', transpose: false }

/** How much room a block will take, which is not its shape if it is turned. */
export const pastedArea = (
  block: CellBlock,
  options: PasteOptions = ORDINARY,
): { rows: number; columns: number } => {
  const one = options.transpose
    ? { rows: block.columns, columns: block.rows }
    : { rows: block.rows, columns: block.columns }

  const over = options.over
  if (over === undefined) return one

  return {
    rows: over.rows >= one.rows && over.rows % one.rows === 0 ? over.rows : one.rows,
    columns:
      over.columns >= one.columns && over.columns % one.columns === 0 ? over.columns : one.columns,
  }
}

/**
 * Puts a block into a sheet, and says what that changed.
 *
 * A block from another window arrives without its styles. A style is an index
 * into the workbook it came from, and the same index here is a different
 * style — so the cells keep whatever the target already looked like, which is
 * the one answer that is never a look nobody chose.
 */
export function pasteBlock(
  sheet: OpenSheet,
  block: CellBlock,
  at: CellBlock['origin'],
  options: PasteOptions = ORDINARY,
): CellChange[] {
  const own = sameSession(block)
  const area = pastedArea(block, options)
  const one = pastedArea(block, { ...options, over: undefined })

  const changes: CellChange[] = []

  for (let tileRow = 0; tileRow < area.rows / one.rows; tileRow += 1) {
    for (let tileColumn = 0; tileColumn < area.columns / one.columns; tileColumn += 1) {
      const corner = {
        row: at.row + tileRow * one.rows,
        column: at.column + tileColumn * one.columns,
      }

      for (const [row, cells] of block.cells.entries()) {
        for (const [column, cell] of cells.entries()) {
          const address = options.transpose
            ? { row: corner.row + column, column: corner.column + row }
            : { row: corner.row + row, column: corner.column + column }
          if (address.row < 0 || address.column < 0) continue

          const change = placed(sheet, cell, address, { own, what: options.what })
          if (change !== null) changes.push(change)
        }
      }
    }
  }

  return changes
}

/** One cell of a block, put where it lands. */
function placed(
  sheet: OpenSheet,
  cell: Cell | null,
  address: { row: number; column: number },
  how: { own: boolean; what: PasteOptions['what'] },
): CellChange | null {
  const existing = sheet.cells.rows.get(address.row)?.get(address.column) ?? null
  const was = { sheet: sheet.path, row: address.row, column: address.column, before: existing }

  // A look pasted over a value leaves the value alone: that is the whole of
  // what "formats" means, and a cell of the target that has nothing in it is
  // still a cell somebody can have made yellow.
  if (how.what === 'formats') {
    const style = how.own ? (cell?.style ?? null) : (existing?.style ?? null)
    if (existing === null && style === null) return null

    const after: Cell =
      existing === null
        ? {
            row: address.row,
            column: address.column,
            type: 'n',
            value: null,
            style,
            formula: null,
            rich: null,
            carried: null,
          }
        : { ...existing, style }

    putCell(sheet.cells, after)
    return { ...was, after }
  }

  // An empty cell in the block empties the cell it lands on: a copied block is
  // a rectangle, and pasting it leaving holes would leave the old values
  // showing through.
  if (cell === null) {
    if (existing === null) return null

    sheet.cells.rows.get(address.row)?.delete(address.column)
    return { ...was, after: null }
  }

  // Worked out for each cell rather than once for the block, because a
  // transposed paste moves every cell by a different distance. A reference in
  // a turned formula is moved rather than turned with it: a shift is what a
  // paste has always meant, and rotating references would be a second rule
  // nobody could predict from the first.
  const by = { rows: address.row - cell.row, columns: address.column - cell.column }

  const pasted: Cell = {
    ...cell,
    row: address.row,
    column: address.column,
    style: how.what === 'all' && how.own ? cell.style : (existing?.style ?? null),
    // Values means the number that is there, not the sum that produced it —
    // which is what everybody uses it for: freezing a result.
    formula:
      how.what === 'values' || cell.formula === null
        ? null
        : { ...cell.formula, text: shiftFormula(cell.formula.text, by) },
  }

  putCell(sheet.cells, pasted)
  return { ...was, after: pasted }
}

/**
 * Writing to and reading from the system clipboard.
 *
 * Behind a seam because the platform's answer is a permission prompt, an async
 * API and a different set of rules in every host — none of which the rest of
 * this should have to know, and none of which a test can exercise.
 */
export async function writeClipboard(copied: Copied): Promise<void> {
  const clipboard = navigator.clipboard as Clipboard | undefined
  if (clipboard === undefined) return

  if (typeof ClipboardItem === 'function' && typeof clipboard.write === 'function') {
    await clipboard.write([
      new ClipboardItem({
        'text/html': new Blob([copied.html], { type: 'text/html' }),
        'text/plain': new Blob([copied.text], { type: 'text/plain' }),
      }),
    ])
    return
  }

  // A host without the rich API still gets the text, which is the half every
  // other program reads anyway.
  await clipboard.writeText(copied.text)
}

export async function readClipboard(): Promise<{ html: string | null; text: string | null }> {
  const clipboard = navigator.clipboard as Clipboard | undefined
  if (clipboard === undefined) return { html: null, text: null }

  if (typeof clipboard.read === 'function') {
    try {
      const items = await clipboard.read()
      for (const item of items) {
        const html = item.types.includes('text/html')
          ? await (await item.getType('text/html')).text()
          : null
        const text = item.types.includes('text/plain')
          ? await (await item.getType('text/plain')).text()
          : null

        if (html !== null || text !== null) return { html, text }
      }
    } catch {
      // Refused, or a host that offers the method and not the permission.
      // The plain text below is the fallback, and it is asked for separately
      // because it is the one every host allows.
    }
  }

  try {
    return { html: null, text: await clipboard.readText() }
  } catch {
    return { html: null, text: null }
  }
}
