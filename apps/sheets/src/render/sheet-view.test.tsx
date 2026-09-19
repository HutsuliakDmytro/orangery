import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import { openWorkbook } from '../document/workbook'
import type { OpenWorkbook } from '../document/workbook'
import { SheetView } from './sheet-view'

/**
 * A worksheet, drawn.
 *
 * The cells are paint, so what is asserted here is what the grid was handed:
 * the strings a sheet shows and the shape it is drawn in. Whether the paint
 * lands where it should is the grid's own suite.
 */

const FIXTURE = join(process.cwd(), 'tests/fixtures/xlsx/budget.xlsx')

let workbook: OpenWorkbook

beforeAll(async () => {
  workbook = await openWorkbook(new Uint8Array(await readFile(FIXTURE)))
})

const drawn = () => {
  const sheet = workbook.sheets[0]
  if (sheet === undefined) throw new Error('the fixture has no sheets')

  render(<SheetView open={workbook} sheet={sheet} width={800} height={400} />)
  return screen.getByRole('grid', { name: 'Budget' })
}

/** What the grid says about the cell it is on, which is the formatted value. */
const announced = async (
  user: ReturnType<typeof userEvent.setup>,
  grid: HTMLElement,
  cell: { row: number; column: number },
) => {
  await user.click(grid)
  await user.keyboard('{ArrowUp>10/}{ArrowLeft>10/}')
  if (cell.row > 0) await user.keyboard(`{ArrowDown>${String(cell.row)}/}`)
  if (cell.column > 0) await user.keyboard(`{ArrowRight>${String(cell.column)}/}`)

  return grid.textContent
}

describe('what the sheet shows', () => {
  it('is a grid named after the sheet', () => {
    drawn()
    expect(screen.getByRole('grid', { name: 'Budget' })).toBeInTheDocument()
  })

  it('holds the rows and columns the cells reach, with room past them', () => {
    // A sheet somebody scrolls is a sheet with somewhere to scroll to: Excel
    // shows empty rows below the last one rather than stopping dead.
    drawn()
    const grid = screen.getByRole('grid', { name: 'Budget' })

    expect(Number(grid.getAttribute('aria-rowcount'))).toBeGreaterThan(3)
    expect(Number(grid.getAttribute('aria-colcount'))).toBeGreaterThanOrEqual(26)
  })

  it('reads a shared string through the table rather than as its index', () => {
    // The classic way to show 0 where January was meant.
    expect(drawn().textContent).toContain('A, row 1: Month')
  })
})

describe('what a cell is shown as', () => {
  it('formats a number by the code its style points at', async () => {
    const user = userEvent.setup()
    const grid = drawn()

    expect(await announced(user, grid, { row: 1, column: 1 })).toContain('B, row 2: 1,234.50')
  })

  it('shows a date as a date rather than as the number it is', async () => {
    // 45292 with format 14 is the 1st of January 2024; without the format it
    // is a five-figure number nobody typed.
    const user = userEvent.setup()
    const grid = drawn()

    expect(await announced(user, grid, { row: 1, column: 2 })).toContain('C, row 2: 01-01-24')
  })

  it('shows a percentage as one', async () => {
    const user = userEvent.setup()
    const grid = drawn()

    expect(await announced(user, grid, { row: 2, column: 2 })).toContain('C, row 3: 16%')
  })

  it('shows a negative through the same format as a positive', async () => {
    const user = userEvent.setup()
    const grid = drawn()

    expect(await announced(user, grid, { row: 2, column: 1 })).toContain('B, row 3: -99.00')
  })
})
