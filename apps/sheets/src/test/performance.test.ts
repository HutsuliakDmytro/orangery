import { describe, expect, it } from 'vitest'
import { cellAt, formatCodeOf, resolveStyle } from '@orangery/ooxml-spreadsheet'
import { formatValue } from '@orangery/numfmt'
import { openWorkbook } from '../document/workbook'
import { buildLargeWorkbook } from './large-workbook'

/**
 * The two numbers the plan states, measured rather than hoped for.
 *
 * A workbook of two hundred thousand cells opens in under two seconds, and a
 * window of them is formatted in under the eight milliseconds a frame has.
 * Both budgets are stated several times looser than the real cost: a shared
 * machine is not a bench. What they catch is the change that turns a linear
 * cost into a quadratic one, and that is an order of magnitude rather than a
 * factor of two.
 *
 * The timed ones are asked for by name rather than run with the rest, which
 * is what the engine's own benchmarks do and for the reason they do it: `pnpm
 * check` at the root runs every package's suite at once, and a machine with
 * ten of them on it opens this workbook in six seconds rather than half of
 * one. A test that fails because something else was busy is a test people
 * learn to ignore, and a suite that cries wolf stops being read at all.
 *
 *     pnpm --filter sheets test:speed
 *
 * The shape of the model is not a measurement and stays where it is.
 */

const CELLS = 200_000

/** Whether the clock is being read, which is only when somebody asked. */
const timed = process.env['MEASURE_SPEED'] === '1'

describe('a workbook the size of a real one', () => {
  it.skipIf(!timed)('opens in under two seconds', { retry: 2 }, async () => {
    const built = await buildLargeWorkbook()
    expect(built.rows * built.columns).toBe(CELLS)

    const started = performance.now()
    const open = await openWorkbook(built.bytes)
    const took = performance.now() - started

    const sheet = open.sheets[0]
    expect(sheet?.cells.rows.size).toBe(built.rows)
    expect(took).toBeLessThan(2000)
  })

  it('reads the cells without keeping the file twice over', async () => {
    // A model that cost what the XML costs would mean a 40 MB sheet needing
    // 80 MB before anything is drawn. Sparse maps of small objects are what
    // this is instead, and the assertion is about the shape: one entry per
    // row, one per cell, and nothing per empty cell.
    const built = await buildLargeWorkbook(500, 20)
    const open = await openWorkbook(built.bytes)
    const sheet = open.sheets[0]

    expect(sheet?.cells.rows.size).toBe(500)
    expect(sheet?.cells.rows.get(0)?.size).toBe(20)
    expect(
      cellAt(sheet?.cells ?? { rows: new Map(), properties: new Map() }, { row: 499, column: 19 }),
    ).not.toBeNull()
  })
})

describe('a window of cells', () => {
  it.skipIf(!timed)('is formatted inside a frame', { retry: 2 }, async () => {
    const built = await buildLargeWorkbook()
    const open = await openWorkbook(built.bytes)
    const sheet = open.sheets[0]
    const styles = open.styles

    if (sheet === undefined || styles === null) throw new Error('the workbook has no sheet')

    // What a repaint asks of the model: every visible cell, through the style
    // cascade and the format code. Forty by twenty is a window on a laptop.
    const resolved = new Map<number, ReturnType<typeof resolveStyle>>()
    const paint = () => {
      for (let row = 0; row < 40; row += 1) {
        for (let column = 0; column < 20; column += 1) {
          const cell = cellAt(sheet.cells, { row, column })
          if (cell === null || cell.value === null) continue

          const index = cell.style ?? 0
          const style = resolved.get(index) ?? resolveStyle(styles, index)
          resolved.set(index, style)

          formatValue(Number(cell.value), formatCodeOf(styles, style.numberFormat), {
            date1904: open.workbook.date1904,
          })
        }
      }
    }

    // Warmed once: the first pass fills the style cache, and a frame that
    // happens to be the first is not the frame worth measuring.
    paint()

    const times = Array.from({ length: 20 }, () => {
      const started = performance.now()
      paint()
      return performance.now() - started
    })

    // The cheapest run: noise only ever adds time, so the fastest is the one
    // that was interrupted least.
    expect(Math.min(...times)).toBeLessThan(8)
  })
})

/**
 * The size the plan states for the release, which is a different question.
 *
 * Two hundred thousand cells is a file people have; a million rows is the
 * file somebody exports from a system and then asks a spreadsheet to open.
 * Excel stops at 1,048,576 rows, so this is the largest sheet that exists —
 * five columns of it, because a million-row export is narrow. A quarter of a
 * gigabyte of zipped XML.
 *
 * Both budgets are printed rather than only asserted. A number that is inside
 * its budget and moving is worth seeing before the day it goes outside.
 */
describe('the largest sheet there is', () => {
  it.skipIf(!timed)('opens a million rows inside its budget', { timeout: 600_000 }, async () => {
    const built = await buildLargeWorkbook(1_000_000, 5)

    // Measured against a heap the builder has let go of: the 250 MB of XML it
    // made is not what the model costs, and counting it would make the model
    // look twice the size it is.
    global.gc?.()
    const before = process.memoryUsage().heapUsed

    const started = performance.now()
    const open = await openWorkbook(built.bytes)
    const took = (performance.now() - started) / 1000

    const heap = (process.memoryUsage().heapUsed - before) / 1e9

    process.stderr.write(
      `    a million rows: open ${took.toFixed(2)} s, model ${heap.toFixed(2)} GB\n`,
    )

    expect(open.sheets[0]?.cells.rows.size).toBe(1_000_000)
    expect(took).toBeLessThan(8)
    expect(heap).toBeLessThan(1.5)
  })
})
