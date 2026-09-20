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
 * Puts a block into a sheet, and says what that changed.
 *
 * Pasted once at the corner rather than tiled across a larger selection; what
 * Excel does with a selection that is a whole multiple of the block is a
 * convenience that can wait for somebody to want it.
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
): CellChange[] {
  const own = sameSession(block)
  const by = { rows: at.row - block.origin.row, columns: at.column - block.origin.column }
  const changes: CellChange[] = []

  for (const [row, cells] of block.cells.entries()) {
    for (const [column, cell] of cells.entries()) {
      const address = { row: at.row + row, column: at.column + column }
      if (address.row < 0 || address.column < 0) continue

      const existing = sheet.cells.rows.get(address.row)?.get(address.column) ?? null
      const was = { sheet: sheet.path, row: address.row, column: address.column, before: existing }

      // An empty cell in the block empties the cell it lands on: a copied
      // block is a rectangle, and pasting it leaving holes would leave the old
      // values showing through.
      if (cell === null) {
        if (existing === null) continue

        sheet.cells.rows.get(address.row)?.delete(address.column)
        changes.push({ ...was, after: null })
        continue
      }

      const pasted: Cell = {
        ...cell,
        row: address.row,
        column: address.column,
        style: own ? cell.style : (existing?.style ?? null),
        formula:
          cell.formula === null
            ? null
            : { ...cell.formula, text: shiftFormula(cell.formula.text, by) },
      }

      putCell(sheet.cells, pasted)
      changes.push({ ...was, after: pasted })
    }
  }

  return changes
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
